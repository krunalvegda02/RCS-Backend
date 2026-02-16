import threading
import requests
import json
import uuid
import time
import os
import signal
import sys
import traceback
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime, timezone
import urllib3
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
import math
import logging
from queue import Queue
from threading import Event
import atexit

# Disable warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('bot_monitor.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global variables with proper initialization
class BotState:
    def __init__(self):
        self.fail = 0
        self.count = 0
        self.token = None
        self.token_generated_time = 0
        self.assistant_id = None
        self.client_secret = None
        self.phonelist = []
        self.retrylist = []
        self.maincampainid = 0
        self.payload = ""
        self.phone_numbers = []
        self.phone_to_message_id = {}
        self.current_index = 0
        self.capable_numbers = []
        self.non_capable_numbers = []
        self.missing_numbers = []
        self.should_refresh_token = False
        self.is_running = True
        self.processing_campaign = False
        self.last_heartbeat = time.time()
        self.active_workers = 0
        self.lock = threading.Lock()
        self.token_refresh_lock = threading.Lock()
        self.worker_errors = Queue()

        # ---- Multi-config support ----
        self.is_multi_config = False
        self.jio_configs = []            # list of {clientId, clientSecret, assistantId}
        self.config_tokens = {}          # {configIndex: token_string}
        self.config_token_times = {}     # {configIndex: timestamp}
        self.phone_to_config_index = {}  # {phone: configIndex}
        self.config_token_locks = {}     # {configIndex: Lock}

bot_state = BotState()

# Database configuration
MONGODB_URI = "mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority"
DATABASE_NAME = "rcs"

# Constants
MAX_API_LIMIT = 10000
MIN_BATCH_SIZE = 500
CONCURRENCY = 30
TOKEN_REFRESH_INTERVAL = 2400  # Refresh token every 40 minutes
TOKEN_EXPIRY_TIME = 3600  # Token expires in 1 hour
HEARTBEAT_INTERVAL = 60  # Send heartbeat every minute
MAX_WORKER_IDLE_TIME = 300  # 5 minutes max idle time for workers
MAX_RETRIES = 3  # Max retries for failed operations
REQUEST_TIMEOUT = 30  # Default request timeout

# MongoDB connection pool
mongo_client = None
mongo_lock = threading.Lock()


def get_mongo_client():
    """Get or create MongoDB client with connection pooling"""
    global mongo_client
    with mongo_lock:
        if mongo_client is None:
            try:
                mongo_client = MongoClient(
                    MONGODB_URI,
                    maxPoolSize=50,
                    minPoolSize=10,
                    maxIdleTimeMS=45000,
                    connectTimeoutMS=30000,
                    socketTimeoutMS=45000,
                    serverSelectionTimeoutMS=30000,
                    retryWrites=True,
                    retryReads=True
                )
                # Test connection
                mongo_client.admin.command('ping')
                logger.info("✅ MongoDB connection pool established")
            except Exception as e:
                logger.error(f"❌ Failed to connect to MongoDB: {e}")
                raise
        return mongo_client

def close_mongo_connections():
    """Close MongoDB connections gracefully"""
    global mongo_client
    with mongo_lock:
        if mongo_client:
            mongo_client.close()
            mongo_client = None
            logger.info("MongoDB connections closed")

# Register cleanup on exit
atexit.register(close_mongo_connections)

def signal_handler(sig, frame):
    """Handle shutdown signals gracefully"""
    logger.info("🛑 Shutdown signal received, cleaning up...")
    bot_state.is_running = False
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def update_heartbeat():
    """Update heartbeat timestamp"""
    bot_state.last_heartbeat = time.time()

def check_health():
    """Check if bot is healthy"""
    current_time = time.time()
    
    # Check if stuck (no heartbeat for too long)
    if current_time - bot_state.last_heartbeat > HEARTBEAT_INTERVAL * 3:
        logger.error(f"🚨 Bot appears stuck! Last heartbeat: {bot_state.last_heartbeat}")
        return False
    
    # Check if workers are alive during campaign
    if bot_state.processing_campaign and bot_state.active_workers == 0:
        if bot_state.current_index < len(bot_state.capable_numbers):
            logger.error("🚨 No active workers but numbers remaining to process!")
            return False
    
    # Check for worker errors
    if not bot_state.worker_errors.empty():
        try:
            error_info = bot_state.worker_errors.get_nowait()
            logger.error(f"Worker error reported: {error_info}")
        except:
            pass
    
    return True

def health_monitor():
    """Background thread to monitor bot health"""
    while bot_state.is_running:
        time.sleep(HEARTBEAT_INTERVAL)
        if not check_health():
            logger.warning("⚠️ Health check failed, but continuing monitoring")
        else:
            logger.debug(f"✅ Health check passed. Active workers: {bot_state.active_workers}")

def get_utc_now():
    """Get current UTC datetime"""
    return datetime.now(timezone.utc)

def safe_mongo_operation(operation_func, *args, **kwargs):
    """Execute MongoDB operation with retries"""
    max_attempts = 3
    for attempt in range(max_attempts):
        try:
            client = get_mongo_client()
            db = client[DATABASE_NAME]
            return operation_func(db, *args, **kwargs)
        except Exception as e:
            logger.warning(f"MongoDB operation failed (attempt {attempt + 1}/{max_attempts}): {e}")
            if attempt == max_attempts - 1:
                logger.error(f"MongoDB operation failed after {max_attempts} attempts")
                raise
            time.sleep(2 ** attempt)  # Exponential backoff

def mark_campaign_running(campaign_id):
    """Mark campaign as Running with retry logic"""
    def _update(db):
        cid = ObjectId(campaign_id) if isinstance(campaign_id, str) else campaign_id
        
        result = db.campaigns.update_one(
            {"_id": cid},
            {"$set": {"status": "running", "updatedAt": get_utc_now()}}
        )
        return result.modified_count > 0
    
    try:
        success = safe_mongo_operation(_update)
        if success:
            logger.info(f"✅ Campaign {campaign_id} marked as 'Running'")
        return success
    except Exception as e:
        logger.error(f"❌ Error marking campaign as Running: {e}")
        return False

def mark_campaign_completed(campaign_id):
    """Mark campaign as completed with retry logic"""
    def _update(db):
        cid = ObjectId(campaign_id) if isinstance(campaign_id, str) else campaign_id
        
        result = db.campaigns.update_one(
            {"_id": cid},
            {
                "$set": {
                    "status": "completed",
                    "updatedAt": get_utc_now(),
                    "completedAt": get_utc_now()
                }
            }
        )
        return result.modified_count > 0
    
    try:
        success = safe_mongo_operation(_update)
        if success:
            logger.info(f"✅ Campaign {campaign_id} marked as 'completed'")
        return success
    except Exception as e:
        logger.error(f"❌ Error marking campaign as completed: {e}")
        return False

def update_campaign_stats(campaign_id, capable_count, non_capable_count, missing_count=0):
    """Update campaign stats with retry logic"""
    def _update(db):
        cid = ObjectId(campaign_id) if isinstance(campaign_id, str) else campaign_id
        
        result = db.campaigns.update_one(
            {"_id": cid},
            {
                "$set": {
                    "rcsCapableCount": capable_count,
                    "nonRcsCapableCount": non_capable_count,
                    "missingCount": missing_count,
                    "updatedAt": get_utc_now()
                }
            }
        )
        return result.modified_count > 0
    
    try:
        success = safe_mongo_operation(_update)
        if success:
            logger.info(f"📊 Campaign stats updated: {capable_count} capable, {non_capable_count} non-capable")
        return success
    except Exception as e:
        logger.error(f"❌ Error updating campaign stats: {e}")
        return False

def get_campaign_data():
    """Get campaign data with connection pooling — single DB round-trip for all data"""
    try:
        client = get_mongo_client()
        db = client[DATABASE_NAME]

        logger.info("🔍 Looking for pending campaign with botId 'bot1'...")
        campaign = db.campaigns.find_one({
            "botId": "bot1",
            "status": "pending"
        })

        if not campaign:
            logger.info("❌ No pending campaign found with botId 'bot1'")
            return None

        campaign_id = campaign["_id"]
        campaign_name = campaign.get("name", "Unnamed")

        logger.info(f"✅ Found pending campaign: {campaign_name} (ID: {campaign_id})")

        payload = campaign["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)

        user_id = campaign.get("userId")
        # Fetch user with jioConfigs secrets included
        user = db.users.find_one(
            {"_id": user_id},
            {"jioConfig": 1, "isMultiConfig": 1, "jioConfigs": 1}
        )

        if not user:
            logger.error("❌ User not found")
            return None

        # Determine single vs multi config
        is_multi = user.get("isMultiConfig", False)
        jio_configs_list = []

        if is_multi and user.get("jioConfigs") and len(user["jioConfigs"]) > 0:
            jio_configs_list = user["jioConfigs"]
            logger.info(f"🔀 Multi-config mode: {len(jio_configs_list)} configs")
            client_id = jio_configs_list[0].get("clientId")
            client_secret = jio_configs_list[0].get("clientSecret")
        else:
            is_multi = False
            jio_config = user.get("jioConfig")
            if not jio_config:
                logger.error("❌ jioConfig not found")
                return None
            client_id = jio_config.get("clientId")
            client_secret = jio_config.get("clientSecret")

        # Get phone numbers, messageIds, and configIndex in ONE query
        phone_numbers_list = []
        phone_message_map = {}
        phone_config_map = {}  # phone -> configIndex

        contacts_cursor = db.contact_campaign_messages.find(
            {"campaignId": campaign_id},
            {"recipientPhoneNumber": 1, "messageId": 1, "configIndex": 1}  # only needed fields
        )

        contacts_count = 0
        for contact in contacts_cursor:
            contacts_count += 1
            phone = contact.get("recipientPhoneNumber")
            if phone:
                phone_numbers_list.append(phone)
                message_id = contact.get("messageId")
                if message_id:
                    phone_message_map[phone] = message_id
                config_idx = contact.get("configIndex")
                if config_idx is not None:
                    phone_config_map[phone] = config_idx

        # Remove duplicates
        unique_phones = list(set(phone_numbers_list))

        logger.info(f"📊 Found {contacts_count} contact records, {len(unique_phones)} unique numbers")

        result = {
            "success": True,
            "campaign_id": str(campaign_id),
            "campaign_name": campaign_name,
            "client_id": client_id,
            "client_secret": client_secret,
            "phone_numbers": unique_phones,
            "phone_message_map": phone_message_map,
            "total_contacts": len(unique_phones),
            "total_records": contacts_count,
            "is_multi_config": is_multi,
            "jio_configs": jio_configs_list,
            "phone_config_map": phone_config_map
        }

        return result

    except Exception as e:
        logger.error(f"❌ Error retrieving campaign data: {e}")
        traceback.print_exc()
        return {"success": False, "error": str(e)}

def get_token(assistant_id, client_secret):
    """Get token with timeout and retry"""
    url = "https://tgs.businessmessaging.jio.com/v1/oauth/token"
    params = {
        "grant_type": "client_credentials",
        "client_id": assistant_id,
        "client_secret": client_secret,
        "scope": "read"
    }

    logger.info(f"🔑 Getting authentication token...")
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(
                url, 
                params=params, 
                verify=False, 
                timeout=REQUEST_TIMEOUT
            )
            
            if response.status_code == 200:
                token = response.json()["access_token"]
                logger.info(f"✅ Token generated successfully")
                return token
            else:
                logger.warning(f"❌ Failed to get token (attempt {attempt + 1}): {response.status_code}")
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)
                else:
                    logger.error(f"Response: {response.text}")
        except requests.exceptions.Timeout:
            logger.warning(f"⏰ Token request timeout (attempt {attempt + 1})")
        except Exception as e:
            logger.warning(f"❌ Exception getting token (attempt {attempt + 1}): {e}")
        
        if attempt < MAX_RETRIES - 1:
            time.sleep(2 ** attempt)
    
    return None

def refresh_token_if_needed(config_index=None):
    """Thread-safe token refresh with retry logic.
    For multi-config: pass config_index to refresh that specific config's token.
    For single-config: pass None (default).
    """
    if config_index is not None and bot_state.is_multi_config:
        # --- Multi-config: per-config token refresh ---
        lock = bot_state.config_token_locks.get(config_index)
        if not lock:
            return False

        with lock:
            current_time = time.time()
            last_time = bot_state.config_token_times.get(config_index, 0)
            current_token = bot_state.config_tokens.get(config_index)

            should_refresh = (
                not current_token or
                (current_time - last_time) >= TOKEN_REFRESH_INTERVAL
            )

            if should_refresh:
                cfg = bot_state.jio_configs[config_index]
                logger.info(f"🔄 Refreshing token for config {config_index} ({cfg.get('label', '')})...")
                new_token = get_token(cfg["clientId"], cfg["clientSecret"])

                if new_token:
                    bot_state.config_tokens[config_index] = new_token
                    bot_state.config_token_times[config_index] = current_time
                    return True
                else:
                    logger.error(f"❌ Failed to refresh token for config {config_index}")
                    return False

            return True
    else:
        # --- Single-config (original behaviour) ---
        with bot_state.token_refresh_lock:
            current_time = time.time()

            should_refresh = (
                not bot_state.token or
                (current_time - bot_state.token_generated_time) >= TOKEN_REFRESH_INTERVAL
            )

            if should_refresh:
                logger.info("🔄 Refreshing authentication token...")
                new_token = get_token(bot_state.assistant_id, bot_state.client_secret)

                if new_token:
                    bot_state.token = new_token
                    bot_state.token_generated_time = current_time
                    bot_state.should_refresh_token = False
                    logger.info("✅ Token refreshed successfully")
                    return True
                else:
                    logger.error("❌ Failed to refresh token")
                    return False

            return True

def format_phone_number(phone):
    """Format phone number to E.164 format with error handling"""
    try:
        digits = ''.join(filter(str.isdigit, str(phone)))
        
        if not digits:
            return None
            
        if len(digits) == 10:
            return f"+91{digits}"
        elif digits.startswith('91') and len(digits) == 12:
            return f"+{digits}"
        elif digits.startswith('91') and len(digits) == 11:
            return f"+{digits}"
        else:
            return f"+91{digits[-10:]}"
    except Exception as e:
        logger.error(f"Error formatting phone {phone}: {e}")
        return None

def get_token_for_message(phone_number):
    """Get the correct token + assistantId for a phone number.
    Multi-config: looks up configIndex, returns that config's token.
    Single-config: returns the global token.
    No DB calls — everything is in memory.
    """
    if bot_state.is_multi_config:
        config_index = bot_state.phone_to_config_index.get(phone_number, 0)
        refresh_token_if_needed(config_index)
        token = bot_state.config_tokens.get(config_index)
        cfg = bot_state.jio_configs[config_index]
        return token, cfg.get("assistantId", bot_state.assistant_id)
    else:
        refresh_token_if_needed()
        return bot_state.token, bot_state.assistant_id

def check_single_user_capability(phone_number, request_id):
    """Check single user capability with timeout"""
    try:
        token, _ = get_token_for_message(phone_number)
        if not token:
            return {"phone": phone_number, "capable": False, "error": "Token refresh failed"}

        formatted_phone = format_phone_number(phone_number)
        if not formatted_phone:
            return {"phone": phone_number, "capable": False, "error": "Invalid phone format"}

        url = f"https://api.businessmessaging.jio.com/v1/messaging/users/{formatted_phone}/capabilities"
        params = {"requestId": request_id}

        headers = {"Authorization": f"Bearer {token}"}

        response = requests.get(
            url, 
            headers=headers, 
            params=params, 
            verify=False, 
            timeout=5
        )

        if response.status_code == 200:
            return {"phone": phone_number, "capable": True}
        else:
            return {"phone": phone_number, "capable": False}
            
    except requests.exceptions.Timeout:
        logger.debug(f"Timeout checking {phone_number}")
        return {"phone": phone_number, "capable": False, "error": "timeout"}
    except Exception as e:
        logger.debug(f"Error checking {phone_number}: {e}")
        return {"phone": phone_number, "capable": False, "error": str(e)}

def check_rcs_capabilities(phone_numbers):
    """Check RCS capabilities with improved error handling"""
    logger.info(f"\n🔍 CHECKING RCS CAPABILITIES for {len(phone_numbers)} numbers")

    capable = []
    non_capable = []
    
    if len(phone_numbers) < 500:
        # Single user checks
        request_id = str(uuid.uuid4())
        
        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(check_single_user_capability, phone, request_id) 
                      for phone in phone_numbers]
            
            for i, future in enumerate(as_completed(futures)):
                result = future.result()
                if result.get("capable"):
                    capable.append(result["phone"])
                else:
                    non_capable.append(result["phone"])
                
                if (i + 1) % 100 == 0:
                    logger.info(f"📊 Processed {i + 1}/{len(phone_numbers)} numbers...")
    else:
        # Batch capability check
        logger.info("⚡ Using batch capability check")
        
        # Create batches
        batch_size = 1000
        batches = [phone_numbers[i:i + batch_size] 
                  for i in range(0, len(phone_numbers), batch_size)]
        
        logger.info(f"📦 Created {len(batches)} batches")
        
        for i, batch in enumerate(batches):
            if not refresh_token_if_needed():
                logger.error("Token refresh failed, stopping capability check")
                break
                
            result = check_batch_capability(batch, i + 1, len(batches))
            
            if result.get("success"):
                capable.extend(result["reachable_phones"])
                # Determine non-capable from batch
                batch_phones_set = set([str(p) for p in batch])
                reachable_set = set(result["reachable_phones"])
                non_capable.extend(list(batch_phones_set - reachable_set))
            else:
                # If batch fails, mark all as non-capable
                non_capable.extend(batch)

    # Remove duplicates
    capable = list(set(capable))
    non_capable = list(set(non_capable))
    
    logger.info(f"📊 Results: {len(capable)} capable, {len(non_capable)} non-capable")
    
    return capable, non_capable, []

def check_batch_capability(phone_numbers_batch, batch_index, total_batches):
    """Check batch capability with timeout"""
    try:
        if not refresh_token_if_needed():
            return {"success": False, "batch_phones": phone_numbers_batch}

        url = "https://api.businessmessaging.jio.com/v1/messaging/usersBatchGet"
        headers = {"Authorization": f"Bearer {bot_state.token}"}

        # Format phone numbers
        formatted_numbers = []
        valid_numbers = []
        for num in phone_numbers_batch:
            formatted = format_phone_number(num)
            if formatted:
                formatted_numbers.append(formatted)
                valid_numbers.append(num)

        if not formatted_numbers:
            return {"success": False, "batch_phones": phone_numbers_batch}

        data = {"phoneNumbers": formatted_numbers}

        response = requests.post(
            url, 
            headers=headers, 
            json=data, 
            verify=False, 
            timeout=30
        )

        if response.status_code == 200:
            result = response.json()
            reachable_users = result.get("reachableUsers", [])
            
            # Extract phone numbers without +91
            reachable_phones = []
            for phone in reachable_users:
                if phone.startswith("+91"):
                    reachable_phones.append(phone[3:])
                else:
                    reachable_phones.append(phone)

            logger.info(f"✅ Batch {batch_index}/{total_batches}: {len(reachable_phones)}/{len(valid_numbers)} reachable")
            
            return {
                "success": True,
                "reachable_phones": reachable_phones,
                "batch_phones": valid_numbers
            }
        else:
            logger.warning(f"❌ Batch {batch_index} failed: HTTP {response.status_code}")
            return {"success": False, "batch_phones": phone_numbers_batch}
            
    except Exception as e:
        logger.error(f"Batch {batch_index} exception: {e}")
        return {"success": False, "batch_phones": phone_numbers_batch}

def send_message_with_retry(phone_number, message_id=None, max_retries=100):
    """Send single message with retry logic and timeout.
    Automatically uses the correct config/token for this phone number.
    Zero DB calls — all lookups are in-memory.
    """
    config_index = bot_state.phone_to_config_index.get(phone_number) if bot_state.is_multi_config else None

    for attempt in range(max_retries):
        try:
            token, assistant_id = get_token_for_message(phone_number)
            if not token:
                if attempt == max_retries - 1:
                    return False
                time.sleep(0.1)
                continue

            if not message_id:
                message_id = f"msg-{uuid.uuid4().hex[:8]}"

            url = f"https://api.businessmessaging.jio.com/v1/messaging/users/+91{phone_number}/assistantMessages/async"
            url += f"?messageId={message_id}&assistantId={assistant_id}"

            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }

            data = {
                "messageTrafficType": "PROMOTION",
                "content": bot_state.payload.get('content', {})
            }

            response = requests.post(
                url, 
                headers=headers, 
                json=data, 
                verify=False, 
                timeout=5
            )

            if response.status_code == 201:
                return True
                
            # Token error - refresh and retry
            if response.status_code == 401:
                refresh_token_if_needed(config_index)
                
        except Exception as e:
            if attempt == max_retries - 1:
                logger.debug(f"Failed to send to {phone_number} after {max_retries} attempts")
            else:
                time.sleep(0.05)  # Very short delay between retries
    
    return False

def worker_thread(worker_id):
    """Worker function with heartbeat and error handling"""
    logger.info(f"🧵 Worker-{worker_id} started")
    last_activity = time.time()
    
    with bot_state.lock:
        bot_state.active_workers += 1
    
    try:
        while bot_state.is_running:
            # Check if we should continue
            if not bot_state.processing_campaign:
                time.sleep(1)
                continue
                
            # Get next number
            with bot_state.lock:
                if bot_state.current_index >= len(bot_state.capable_numbers):
                    break
                number = bot_state.capable_numbers[bot_state.current_index]
                bot_state.current_index += 1
                last_activity = time.time()
            
            # Check for idle timeout
            if time.time() - last_activity > MAX_WORKER_IDLE_TIME:
                logger.warning(f"Worker-{worker_id} idle for too long, but continuing")
            
            # Refresh token periodically
            if bot_state.current_index % 500 == 0:
                refresh_token_if_needed()
            
            # Send message
            message_id = bot_state.phone_to_message_id.get(number)
            success = send_message_with_retry(number, message_id)
            
            with bot_state.lock:
                if success:
                    bot_state.count += 1
                    bot_state.phonelist.append(number)
                else:
                    bot_state.fail += 1
                    bot_state.retrylist.append(number)
            
            # Small yield to prevent CPU overload
            time.sleep(0.001)
            
    except Exception as e:
        logger.error(f"Worker-{worker_id} crashed: {e}")
        traceback.print_exc()
        bot_state.worker_errors.put(f"Worker-{worker_id}: {str(e)}")
    finally:
        with bot_state.lock:
            bot_state.active_workers -= 1
        logger.info(f"🧵 Worker-{worker_id} stopped")

def process_campaign():
    """Main campaign processing function"""
    global bot_state
    
    update_heartbeat()
    
    # Get campaign data
    data = get_campaign_data()
    
    if not data or not data.get("success"):
        logger.info("No pending campaign found")
        return None
    
    if data.get('total_contacts', 0) == 0:
        logger.info("No contacts to send. Marking campaign as completed.")
        mark_campaign_completed(data['campaign_id'])
        return None
    
    # Set campaign state
    bot_state.processing_campaign = True
    bot_state.maincampainid = data['campaign_id']
    bot_state.assistant_id = data['client_id']
    bot_state.client_secret = data['client_secret']
    bot_state.phone_numbers = data['phone_numbers']
    bot_state.phone_to_message_id = data.get('phone_message_map', {})
    bot_state.payload = data.get('payload', {})

    # Multi-config setup (all in-memory, no extra DB calls)
    bot_state.is_multi_config = data.get('is_multi_config', False)
    bot_state.jio_configs = data.get('jio_configs', [])
    bot_state.phone_to_config_index = data.get('phone_config_map', {})
    bot_state.config_tokens = {}
    bot_state.config_token_times = {}
    bot_state.config_token_locks = {}
    
    logger.info(f"📋 Processing campaign: {data['campaign_name']} ({len(bot_state.phone_numbers)} contacts)")
    if bot_state.is_multi_config:
        logger.info(f"🔀 Multi-config mode: {len(bot_state.jio_configs)} configs")
    
    # Mark as running
    if not mark_campaign_running(bot_state.maincampainid):
        logger.error("Failed to mark campaign as Running")
        bot_state.processing_campaign = False
        return None
    
    # Get tokens — one per config in multi-config, or single token
    if bot_state.is_multi_config and len(bot_state.jio_configs) > 0:
        logger.info(f"🔐 Getting tokens for {len(bot_state.jio_configs)} configs...")
        all_tokens_ok = True
        for i, cfg in enumerate(bot_state.jio_configs):
            bot_state.config_token_locks[i] = threading.Lock()
            token = get_token(cfg["clientId"], cfg["clientSecret"])
            if token:
                bot_state.config_tokens[i] = token
                bot_state.config_token_times[i] = time.time()
                logger.info(f"  ✅ Config {i} ({cfg.get('label', 'Bot ' + str(i+1))}): token OK")
            else:
                logger.error(f"  ❌ Config {i}: token FAILED")
                all_tokens_ok = False
        if not any(bot_state.config_tokens.values()):
            logger.error("All config tokens failed")
            mark_campaign_completed(bot_state.maincampainid)
            bot_state.processing_campaign = False
            return None
    else:
        logger.info("🔐 Getting initial token...")
        bot_state.token = get_token(bot_state.assistant_id, bot_state.client_secret)
        if not bot_state.token:
            logger.error("Authentication failed")
            mark_campaign_completed(bot_state.maincampainid)
            bot_state.processing_campaign = False
            return None
        bot_state.token_generated_time = time.time()
    
    # Check capabilities
    capable, non_capable, missing = check_rcs_capabilities(bot_state.phone_numbers)
    bot_state.capable_numbers = capable
    bot_state.non_capable_numbers = non_capable
    bot_state.missing_numbers = missing
    
    # Update stats
    update_campaign_stats(
        bot_state.maincampainid,
        len(capable),
        len(non_capable),
        len(missing)
    )
    
    if len(capable) == 0:
        logger.info("No RCS capable contacts found")
        mark_campaign_completed(bot_state.maincampainid)
        bot_state.processing_campaign = False
        return None
    
    # Reset counters
    bot_state.current_index = 0
    bot_state.count = 0
    bot_state.fail = 0
    bot_state.phonelist.clear()
    bot_state.retrylist.clear()
    
    logger.info(f"🎯 Starting message sending to {len(capable)} capable contacts")
    
    # Start workers
    num_workers = 100
    threads = []
    start_time = time.time()
    
    for i in range(num_workers):
        t = threading.Thread(target=worker_thread, args=(i + 1,), daemon=True)
        t.start()
        threads.append(t)
    
    # Monitor workers
    while bot_state.active_workers > 0 and bot_state.is_running:
        time.sleep(5)
        update_heartbeat()
        
        # Log progress
        with bot_state.lock:
            progress = (bot_state.current_index / len(capable)) * 100
            logger.info(f"📊 Progress: {bot_state.current_index}/{len(capable)} ({progress:.1f}%) - "
                       f"Sent: {bot_state.count}, Failed: {bot_state.fail}")
        
        # Check if workers are stuck
        if time.time() - start_time > 3600:  # 1 hour timeout
            logger.warning("Campaign taking too long, forcing completion")
            break
    
    # Wait for workers to finish
    for t in threads:
        t.join(timeout=30)
    
    processing_time = time.time() - start_time
    
    # Final results
    logger.info("=" * 60)
    logger.info("✅ CAMPAIGN COMPLETED")
    logger.info("=" * 60)
    logger.info(f"📊 Sent: {bot_state.count}, Failed: {bot_state.fail}")
    logger.info(f"⏱️  Time: {processing_time:.2f}s, Rate: {bot_state.count/processing_time:.2f}/s")
    
    # Mark as completed
    mark_campaign_completed(bot_state.maincampainid)
    bot_state.processing_campaign = False
    
    return {
        "campaign_id": bot_state.maincampainid,
        "sent": bot_state.count,
        "failed": bot_state.fail,
        "capable": len(capable),
        "non_capable": len(non_capable),
        "processing_time": processing_time
    }

def main_loop():
    """Main loop with health monitoring"""
    logger.info("=" * 60)
    logger.info("🚀 BOT STARTED - Monitoring for campaigns")
    logger.info("=" * 60)
    
    # Start health monitor
    monitor_thread = threading.Thread(target=health_monitor, daemon=True)
    monitor_thread.start()
    
    while bot_state.is_running:
        try:
            update_heartbeat()
            
            if not bot_state.processing_campaign:
                logger.info("🔄 Checking for pending campaigns...")
                result = process_campaign()
                
                if result:
                    logger.info(f"📊 Campaign completed: {result}")
                else:
                    logger.info("No campaign to process")
            
            # Wait before next check
            for _ in range(30):
                if not bot_state.is_running:
                    break
                time.sleep(1)
                update_heartbeat()
                
        except KeyboardInterrupt:
            logger.info("🛑 Bot stopped by user")
            break
        except Exception as e:
            logger.error(f"❌ Unexpected error in main loop: {e}")
            traceback.print_exc()
            time.sleep(60)  # Wait before retry
    
    logger.info("👋 Bot shutting down...")
    close_mongo_connections()

if __name__ == "__main__":
    main_loop()