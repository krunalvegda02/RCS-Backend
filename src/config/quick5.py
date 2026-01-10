import json
import time
import threading
import requests
import uuid
import re
import sys
import signal
from datetime import datetime, timedelta
from pymongo import MongoClient
from bson import ObjectId
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import math
from collections import defaultdict, deque
import urllib3
import pandas as pd
import os
from queue import Queue, PriorityQueue
import random
import concurrent.futures

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


class ResponseRecorder:
    """Record all responses for Excel export"""

    def __init__(self, campaign_id, campaign_name):
        self.campaign_id = campaign_id
        self.campaign_name = campaign_name
        self.responses = []
        self.lock = threading.Lock()

        # Track retry attempts by error type
        self.retry_counts = defaultdict(int)  # phone -> retry count
        self.successful_retries = {}  # phone -> retry_count when succeeded

        # Error tracking
        self.error_types = defaultdict(int)
        self.phones_final_status = {}  # phone -> final status info
        self.phone_error_types = defaultdict(set)  # phone -> set of error types encountered

        # Create results directory if it doesn't exist
        os.makedirs("campaign_results", exist_ok=True)

    def classify_error_type(self, status, response_code, error_message):
        """Classify error type for better reporting"""
        if status == 'success':
            return "success"
        elif response_code == 429:
            return "429_rate_limit"
        elif response_code:
            return f"http_{response_code}"
        elif error_message:
            error_str = str(error_message).lower()
            if "timeout" in error_str:
                return "timeout"
            elif "connection" in error_str or "connect" in error_str:
                return "connection_error"
            elif "invalid phone" in error_str:
                return "invalid_phone"
            else:
                return "other_error"
        else:
            return "unknown_error"

    def add_response(self, phone, formatted_phone, message_id, status,
                     response_code=None, error_message=None, timestamp=None,
                     retry_count=0, is_retry=False, error_type=None):
        """Add a response record"""
        if timestamp is None:
            timestamp = datetime.now()

        # Determine error type
        if error_type is None:
            error_type = self.classify_error_type(status, response_code, error_message)

        record = {
            'campaign_id': self.campaign_id,
            'campaign_name': self.campaign_name,
            'phone': phone,
            'formatted_phone': formatted_phone,
            'message_id': message_id,
            'status': status,
            'response_code': response_code,
            'error_message': error_message,
            'error_type': error_type,
            'timestamp': timestamp,
            'date': timestamp.date(),
            'time': timestamp.time(),
            'retry_count': retry_count,
            'is_retry': is_retry
        }

        with self.lock:
            self.responses.append(record)

            # Track error types for this phone
            if phone:
                self.phone_error_types[phone].add(error_type)

            # Update phone's final status (most recent record wins)
            self.phones_final_status[phone] = {
                'status': status,
                'error_type': error_type,
                'retry_count': retry_count,
                'is_retry': is_retry,
                'response_code': response_code,
                'timestamp': timestamp
            }

            # Track successful retries
            if status == 'success' and is_retry:
                self.successful_retries[phone] = retry_count

            # Track error types for failures
            if status == 'failed':
                self.error_types[error_type] += 1

    def get_retry_count(self, phone):
        """Get retry count for a phone"""
        with self.lock:
            return self.retry_counts.get(phone, 0)

    def increment_retry_count(self, phone):
        """Increment retry count for a phone"""
        with self.lock:
            self.retry_counts[phone] = self.retry_counts.get(phone, 0) + 1
            return self.retry_counts[phone]

    def get_phone_error_types(self, phone):
        """Get error types encountered for a phone"""
        with self.lock:
            return list(self.phone_error_types.get(phone, set()))

    def save_to_excel(self):
        """Save all responses to Excel file - SORTED by phone then timestamp"""
        if not self.responses:
            return None

        try:
            # Create DataFrame
            df = pd.DataFrame(self.responses)

            # Convert timestamp to datetime if needed
            if 'timestamp' in df.columns:
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df['date'] = df['timestamp'].dt.date
                df['time'] = df['timestamp'].dt.time

            # Sort by phone then timestamp for better analysis
            if 'phone' in df.columns and 'timestamp' in df.columns:
                df = df.sort_values(['phone', 'timestamp'])

            # Reorder columns for better readability
            column_order = [
                'campaign_name', 'campaign_id', 'phone', 'formatted_phone',
                'message_id', 'status', 'response_code', 'error_message',
                'error_type', 'retry_count', 'is_retry', 'date', 'time', 'timestamp'
            ]

            # Only include columns that exist
            available_columns = [col for col in column_order if col in df.columns]
            df = df[available_columns]

            # Create filename with timestamp
            timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"campaign_results/{self.campaign_name}_{timestamp_str}.xlsx"

            # Save to Excel
            df.to_excel(filename, index=False, engine='openpyxl')

            logger.info(f"📊 Saved {len(self.responses)} responses to {filename}")
            return filename

        except Exception as e:
            logger.error(f"Error saving to Excel: {str(e)}")
            return None

    def get_summary(self):
        """Get accurate summary statistics based on final status"""
        with self.lock:
            total_phones = len(self.phones_final_status)

            # Count final statuses
            success_count = 0
            failed_429_count = 0
            failed_timeout_count = 0
            failed_other_count = 0

            for phone, data in self.phones_final_status.items():
                if data['status'] == 'success':
                    success_count += 1
                elif data['status'] == 'failed':
                    if data['error_type'] == '429_rate_limit':
                        failed_429_count += 1
                    elif data['error_type'] == 'timeout':
                        failed_timeout_count += 1
                    else:
                        failed_other_count += 1

            failed_total = failed_429_count + failed_timeout_count + failed_other_count

            # Calculate retry stats
            total_retries = sum(self.retry_counts.values())
            successful_retry_count = len(self.successful_retries)
            max_retries = max(self.retry_counts.values()) if self.retry_counts else 0

            # Get error breakdown
            error_breakdown = dict(self.error_types)

            return {
                'total_phones': total_phones,
                'success': success_count,
                'failed_total': failed_total,
                'failed_429': failed_429_count,
                'failed_timeout': failed_timeout_count,
                'failed_other': failed_other_count,
                'total_retries': total_retries,
                'successful_retries': successful_retry_count,
                'max_retries': max_retries,
                'success_rate': (success_count / total_phones * 100) if total_phones > 0 else 0,
                'responses_recorded': len(self.responses),
                'error_breakdown': error_breakdown,
                'unique_phones_retried': len(self.retry_counts)
            }


class RetryManager:
    """Manage retries with different policies for different error types"""

    def __init__(self, response_recorder):
        self.retry_queue = Queue()
        self.retry_counts = defaultdict(int)
        self.successful_retries = defaultdict(int)
        self.response_recorder = response_recorder
        self.lock = threading.Lock()
        self.active = True
        self.stats_lock = threading.Lock()
        self.retry_attempts = 0
        self.successful_retry_count = 0

        # Retry policies
        self.retry_policies = {
            '429_rate_limit': {
                'max_retries': float('inf'),  # Unlimited retries
                'delay_range': (0.5, 2.0),  # Delay between retries
                'retry_message': ' (429 retry queued)'
            },
            'timeout': {
                'max_retries': 100,  # Max 100 retries for timeout
                'delay_range': (1.0, 3.0),  # Longer delay for timeouts
                'retry_message': ' (timeout retry queued)'
            },
            # Other errors: no retry by default
        }

    def should_retry(self, phone, error_type, current_retry_count):
        """Check if a phone should be retried based on error type and retry count"""
        if error_type not in self.retry_policies:
            return False

        policy = self.retry_policies[error_type]
        max_retries = policy['max_retries']

        # Check if we've exceeded max retries
        if max_retries is not None and current_retry_count >= max_retries:
            return False

        return True

    def add_for_retry(self, phone, formatted_phone, message_data, message_id, thread_id, error_type):
        """Add message to retry queue based on error type"""
        with self.lock:
            self.retry_counts[phone] += 1

        # Get current retry count from recorder
        retry_count = self.response_recorder.get_retry_count(phone)

        retry_data = {
            'phone': phone,
            'formatted_phone': formatted_phone,
            'message_data': message_data,
            'message_id': message_id,
            'thread_id': thread_id,
            'retry_count': retry_count,
            'error_type': error_type,
            'timestamp': time.time()
        }

        self.retry_queue.put(retry_data)

        with self.stats_lock:
            self.retry_attempts += 1

    def mark_success(self, phone, error_type):
        """Mark a retry as successful"""
        with self.lock:
            self.successful_retries[(phone, error_type)] = self.retry_counts.get(phone, 0)

        with self.stats_lock:
            self.successful_retry_count += 1

    def get_retry_delay(self, error_type):
        """Get delay range for retry based on error type"""
        policy = self.retry_policies.get(error_type, {'delay_range': (1.0, 2.0)})
        return policy['delay_range']

    def get_retry_message(self, error_type, retry_count):
        """Get retry message based on error type"""
        policy = self.retry_policies.get(error_type, {})
        base_message = policy.get('retry_message', ' (retry queued)')

        if error_type == '429_rate_limit':
            return f" (429 retry #{retry_count} queued)"
        elif error_type == 'timeout':
            return f" (timeout retry #{retry_count} queued)"
        else:
            return base_message

    def get_stats(self):
        """Get retry statistics"""
        with self.lock:
            total_retries = sum(self.retry_counts.values())
            successful_retries = len(self.successful_retries)
            max_retries = max(self.retry_counts.values()) if self.retry_counts else 0

            # Count retries by error type
            error_type_counts = defaultdict(int)
            for phone, count in self.retry_counts.items():
                # Get latest error type for this phone
                error_types = self.response_recorder.get_phone_error_types(phone)
                if error_types:
                    error_type_counts[error_types[-1]] += count

            return {
                'queue_size': self.retry_queue.qsize(),
                'total_retries': total_retries,
                'successful_retries': successful_retries,
                'max_retries': max_retries,
                'unique_numbers': len(self.retry_counts),
                'retry_attempts': self.retry_attempts,
                'successful_retry_count': self.successful_retry_count,
                'error_type_counts': dict(error_type_counts)
            }

    def stop(self):
        """Stop retry processing"""
        self.active = False


class HighPerformanceTokenManager:
    """Optimized token manager with connection pooling"""

    def __init__(self, assistant_id: str, client_secret: str):
        self.assistant_id = assistant_id
        self.client_secret = client_secret
        self.token_url = "https://tgs.businessmessaging.jio.com/v1/oauth/token"

        self.access_token = None
        self.token_expiry = None
        self.token_lock = threading.Lock()

        # Multiple sessions for better performance
        self.sessions = []
        for _ in range(5):  # 5 connections for token fetching
            session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(
                pool_connections=5,
                pool_maxsize=20,
                max_retries=2,
                pool_block=True
            )
            session.mount('https://', adapter)
            session.mount('http://', adapter)
            self.sessions.append(session)

    def get_token(self):
        """Get OAuth token with retry logic"""
        with self.token_lock:
            if self.access_token and datetime.now() < self.token_expiry:
                return self.access_token

            # Try with different sessions
            for session in self.sessions:
                try:
                    params = {
                        "grant_type": "client_credentials",
                        "client_id": self.assistant_id,
                        "client_secret": self.client_secret,
                        "scope": "read"
                    }

                    response = session.get(
                        self.token_url,
                        params=params,
                        timeout=10,
                        verify=False
                    )

                    if response.status_code == 200:
                        data = response.json()
                        self.access_token = data.get("access_token")
                        expires_in = data.get("expires_in", 3600)
                        self.token_expiry = datetime.now() + timedelta(seconds=expires_in - 60)
                        logger.info(f"✅ Token obtained, valid for {expires_in}s")
                        return self.access_token

                except Exception as e:
                    logger.debug(f"Token fetch attempt failed: {str(e)}")
                    continue

            logger.error("❌ All token fetch attempts failed")
            return None


class HighPerformanceSender:
    """High performance message sender with smart retry policies"""

    def __init__(self, token_manager: HighPerformanceTokenManager, response_recorder: ResponseRecorder):
        self.token_manager = token_manager
        self.response_recorder = response_recorder
        self.messaging_url = "https://api.businessmessaging.jio.com/v1/messaging/users/{phone}/assistantMessages/async"

        # Statistics
        self.sent_count = 0
        self.failed_count = 0
        self.failed_429_count = 0
        self.failed_timeout_count = 0
        self.failed_other_count = 0
        self.retry_attempts = 0
        self.success_after_retry = 0
        self.stats_lock = threading.Lock()

        # Connection pools per thread
        self.thread_sessions = {}

        # Initialize retry manager with smart policies
        self.retry_manager = RetryManager(response_recorder)

        # Start retry processor threads
        self.retry_threads = []
        self.start_retry_processors(5)  # 5 retry processor threads

    def start_retry_processors(self, num_threads):
        """Start threads to process retry queue"""
        for i in range(num_threads):
            thread = threading.Thread(target=self.process_retry_queue, daemon=True, name=f"RetryProcessor-{i}")
            thread.start()
            self.retry_threads.append(thread)

    def process_retry_queue(self):
        """Process retry queue with different policies for different error types"""
        while self.retry_manager.active:
            try:
                # Get next retry task
                task = self.retry_manager.retry_queue.get(timeout=1)

                phone = task['phone']
                formatted_phone = task['formatted_phone']
                message_data = task['message_data']
                message_id = task['message_id']
                thread_id = task['thread_id']
                retry_count = task['retry_count']
                error_type = task['error_type']

                # Get delay based on error type
                delay_range = self.retry_manager.get_retry_delay(error_type)
                time.sleep(random.uniform(*delay_range))

                # Try sending again
                success, error_message, response_code = self._send_message(
                    phone, formatted_phone, message_data, message_id, thread_id
                )

                timestamp = datetime.now()

                if success:
                    # INCREMENT retry count before recording success
                    new_retry_count = self.response_recorder.increment_retry_count(phone)

                    # Record SUCCESS with proper error_type
                    self.response_recorder.add_response(
                        phone, formatted_phone, message_id, 'success',
                        response_code, error_message, timestamp,
                        new_retry_count, True, "success"
                    )

                    with self.stats_lock:
                        self.sent_count += 1
                        self.success_after_retry += 1

                    self.retry_manager.mark_success(phone, error_type)
                    logger.debug(f"✅ {error_type} Retry SUCCESS for {phone} after {new_retry_count} attempts")

                else:
                    # INCREMENT retry count for failed retry
                    new_retry_count = self.response_recorder.increment_retry_count(phone)

                    # Classify new error
                    new_error_type = self.response_recorder.classify_error_type('failed', response_code, error_message)

                    # Check if we should retry this new error
                    if self.retry_manager.should_retry(phone, new_error_type, new_retry_count):
                        # Record FAILED retry attempt
                        retry_message = self.retry_manager.get_retry_message(new_error_type, new_retry_count)
                        self.response_recorder.add_response(
                            phone, formatted_phone, message_id, 'failed',
                            response_code, error_message + retry_message,
                            timestamp, new_retry_count, True, new_error_type
                        )

                        # Re-queue for another retry with NEW error type
                        self.retry_manager.add_for_retry(
                            phone, formatted_phone, message_data, message_id, thread_id, new_error_type
                        )

                        logger.debug(f"⏳ Re-queued {phone} for {new_error_type} retry #{new_retry_count}")
                    else:
                        # Max retries reached or error type not retryable - FINAL FAILURE
                        with self.stats_lock:
                            self.failed_count += 1
                            if new_error_type == '429_rate_limit':
                                self.failed_429_count += 1
                            elif new_error_type == 'timeout':
                                self.failed_timeout_count += 1
                            else:
                                self.failed_other_count += 1

                        # Record final failure
                        final_message = " (FINAL - "
                        if new_retry_count >= 100 and new_error_type == 'timeout':
                            final_message += "max 100 timeout retries reached)"
                        elif new_error_type == '429_rate_limit':
                            final_message += "429 rate limit - unlimited retries exhausted)"
                        else:
                            final_message += "no retry for this error type)"

                        self.response_recorder.add_response(
                            phone, formatted_phone, message_id, 'failed',
                            response_code, error_message + final_message,
                            timestamp, new_retry_count, True, new_error_type
                        )

                        logger.debug(f"❌ Final failure for {phone} during {error_type} retry: {error_message}")

                self.retry_manager.retry_queue.task_done()

            except Exception as e:
                # Queue timeout or other error, continue
                continue

    def get_session_for_thread(self, thread_id):
        """Get or create session for thread"""
        if thread_id not in self.thread_sessions:
            session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(
                pool_connections=3,
                pool_maxsize=10,
                max_retries=1,
                pool_block=False
            )
            session.mount('https://', adapter)
            session.mount('http://', adapter)
            self.thread_sessions[thread_id] = session
        return self.thread_sessions[thread_id]

    def format_phone(self, phone: str) -> str:
        """Format phone to E.164"""
        try:
            if not phone:
                return None

            digits = re.sub(r'\D', '', str(phone))

            if not digits:
                return None

            if len(digits) == 10:
                return f"+91{digits}"
            elif len(digits) == 12 and digits.startswith('91'):
                return f"+{digits}"
            elif len(digits) == 11 and digits.startswith('0'):
                return f"+91{digits[1:]}"
            elif len(digits) >= 10 and len(digits) <= 15:
                return f"+{digits}"
            else:
                return None

        except Exception as e:
            return None

    def _send_message(self, phone: str, formatted_phone: str, message_data: dict,
                      message_id: str, thread_id: int):
        """Internal method for sending message"""
        response_code = None
        error_message = None

        try:
            # Get token
            token = self.token_manager.get_token()
            if not token:
                error_message = "Failed to get token"
                return False, error_message, None

            # Build URL
            url = self.messaging_url.format(phone=formatted_phone)
            url += f"?messageId={message_id}&assistantId={self.token_manager.assistant_id}"

            # Get session for this thread
            session = self.get_session_for_thread(thread_id)

            # Prepare payload
            payload = message_data.copy()
            if "messageTrafficType" not in payload:
                payload["messageTrafficType"] = "PROMOTION"

            # Send request
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }

            response = session.post(
                url,
                headers=headers,
                json=payload,
                timeout=8,
                verify=False
            )

            response_code = response.status_code

            if response.status_code == 201:
                error_message = "Success"
                return True, error_message, response_code
            else:
                error_message = f"HTTP {response.status_code}"

                # Try to get error details from response
                try:
                    error_details = response.json()
                    if isinstance(error_details, dict):
                        error_message = error_details.get('message', error_message)
                except:
                    pass

                return False, error_message, response_code

        except requests.exceptions.Timeout as e:
            error_message = "Request timeout"
            return False, error_message, None

        except requests.exceptions.ConnectionError as e:
            error_message = f"Connection error: {str(e)}"
            return False, error_message, None

        except Exception as e:
            error_message = f"Unexpected error: {str(e)}"
            return False, error_message, None

    def send_single_message(self, phone: str, message_data: dict, message_id: str, thread_id: int = 0):
        """Send a single message with smart retry policies"""
        formatted_phone = self.format_phone(phone)
        if not formatted_phone:
            error_message = "Invalid phone format"
            self.response_recorder.add_response(
                phone, None, message_id, 'failed',
                None, error_message, datetime.now(), 0, False, "invalid_phone"
            )
            return False, error_message

        # Initial attempt
        timestamp = datetime.now()

        # Try sending
        success, error_message, response_code = self._send_message(
            phone, formatted_phone, message_data, message_id, thread_id
        )

        if success:
            with self.stats_lock:
                self.sent_count += 1

            # Record success
            self.response_recorder.add_response(
                phone, formatted_phone, message_id, 'success',
                response_code, error_message, timestamp, 0, False, "success"
            )
            return True, error_message
        else:
            # Classify error
            error_type = self.response_recorder.classify_error_type('failed', response_code, error_message)

            # Check if we should retry this error
            if self.retry_manager.should_retry(phone, error_type, 0):
                # Record initial failure
                retry_message = self.retry_manager.get_retry_message(error_type, 1)
                self.response_recorder.add_response(
                    phone, formatted_phone, message_id, 'failed',
                    response_code, error_message + retry_message,
                    timestamp, 0, False, error_type
                )

                # Add to retry queue
                self.retry_manager.add_for_retry(
                    phone, formatted_phone, message_data, message_id, thread_id, error_type
                )

                with self.stats_lock:
                    if error_type == '429_rate_limit':
                        self.failed_429_count += 1
                    elif error_type == 'timeout':
                        self.failed_timeout_count += 1
                    else:
                        self.failed_other_count += 1

                return False, f"{error_type} - Retry queued"
            else:
                # No retry for this error type - FINAL FAILURE
                with self.stats_lock:
                    self.failed_count += 1
                    if error_type == '429_rate_limit':
                        self.failed_429_count += 1
                    elif error_type == 'timeout':
                        self.failed_timeout_count += 1
                    else:
                        self.failed_other_count += 1

                # Record final failure (no retry)
                self.response_recorder.add_response(
                    phone, formatted_phone, message_id, 'failed',
                    response_code, error_message + " (FINAL - no retry)",
                    timestamp, 0, False, error_type
                )

                return False, f"Failed ({error_type}): {error_message}"

    def get_stats(self):
        """Get sender statistics"""
        retry_stats = self.retry_manager.get_stats()

        with self.stats_lock:
            return {
                'sent': self.sent_count,
                'failed_total': self.failed_count,
                'failed_429': self.failed_429_count,
                'failed_timeout': self.failed_timeout_count,
                'failed_other': self.failed_other_count,
                'retry_attempts': retry_stats['retry_attempts'],
                'success_after_retry': retry_stats['successful_retry_count'],
                'retry_queue_size': retry_stats['queue_size'],
                'total_retries': retry_stats['total_retries'],
                'successful_retries': retry_stats['successful_retries'],
                'max_retries': retry_stats['max_retries'],
                'unique_retry_numbers': retry_stats['unique_numbers'],
                'retry_by_error_type': retry_stats['error_type_counts']
            }


class UltraFastCampaignProcessor:
    """Process campaigns with smart retry policies"""

    def __init__(self, campaign, token_manager, db):
        self.campaign = campaign
        self.token_manager = token_manager
        self.db = db

        # Campaign info
        self.campaign_id = str(campaign["_id"])
        self.campaign_name = campaign.get("name", "Unnamed")

        # Initialize response recorder
        self.response_recorder = ResponseRecorder(self.campaign_id, self.campaign_name)

        # Initialize sender with recorder
        self.sender = HighPerformanceSender(token_manager, self.response_recorder)

        self.should_stop = False

        # Parse payload
        payload = campaign.get("payload", "{}")
        if isinstance(payload, str):
            self.message_data = json.loads(payload)
        else:
            self.message_data = payload

        # Ensure messageTrafficType
        if "messageTrafficType" not in self.message_data:
            self.message_data["messageTrafficType"] = "PROMOTION"

        # Thread executor for parallel processing
        self.executor = None

    def run(self):
        """Process the campaign with smart retry policies"""
        logger.info(f"⚡ Processing campaign: {self.campaign_name}")
        logger.info("🔄 RETRY POLICIES:")
        logger.info("  • 429 errors: UNLIMITED retries")
        logger.info("  • Timeout errors: MAX 100 retries")
        logger.info("  • Other errors: NO RETRY")

        # Get total recipients
        total_recipients = self.db.contact_campaign_messages.count_documents({
            "campaignIds": ObjectId(self.campaign_id)
        })

        if total_recipients == 0:
            logger.warning(f"No recipients for campaign {self.campaign_name}")
            return {'sent': 0, 'failed': 0, 'failed_429': 0, 'failed_timeout': 0, 'failed_other': 0}

        # Update campaign status
        self.db.campaigns.update_one(
            {"_id": ObjectId(self.campaign_id)},
            {"$set": {"status": "running", "updatedAt": datetime.now()}}
        )

        logger.info(f"📊 Total recipients: {total_recipients:,}")

        campaign_start_time = time.time()

        # Process in parallel batches
        batch_size = 500
        total_batches = math.ceil(total_recipients / batch_size)

        # Create executor with threads
        self.executor = ThreadPoolExecutor(max_workers=50)

        processed_phones = set()

        for batch_num in range(total_batches):
            if self.should_stop:
                break

            skip = batch_num * batch_size

            # Get recipients for this batch
            recipients = list(self.db.contact_campaign_messages.find({
                "campaignIds": ObjectId(self.campaign_id)
            }).skip(skip).limit(batch_size))

            if not recipients:
                continue

            # Process this batch in parallel
            self.process_batch(recipients, batch_num, processed_phones)

            # Calculate and log progress
            processed = min((batch_num + 1) * batch_size, total_recipients)
            elapsed = time.time() - campaign_start_time
            tps = processed / elapsed if elapsed > 0 else 0
            percent = (processed / total_recipients) * 100

            # Get response summary
            summary = self.response_recorder.get_summary()
            sender_stats = self.sender.get_stats()

            logger.info(
                f"{self.campaign_name} | "
                f"Progress: {processed:,}/{total_recipients:,} ({percent:.1f}%) | "
                f"Sent: {summary['success']:,} | "
                f"Failed 429: {summary['failed_429']:,} | "
                f"Failed Timeout: {summary['failed_timeout']:,} | "
                f"Failed Other: {summary['failed_other']:,} | "
                f"Retry Queue: {sender_stats['retry_queue_size']:,} | "
                f"TPS: {tps:.1f}"
            )

        # Wait for retry queue to empty
        logger.info(f"⏳ Waiting for retry queue to empty...")

        retry_wait_start = time.time()
        last_log_time = time.time()
        last_queue_size = float('inf')

        while True:
            current_time = time.time()
            sender_stats = self.sender.get_stats()
            queue_size = sender_stats['retry_queue_size']

            # Log progress every 10 seconds or if queue size changes significantly
            if current_time - last_log_time >= 10 or abs(queue_size - last_queue_size) > 10:
                summary = self.response_recorder.get_summary()

                # Show retry stats by error type
                retry_by_type = sender_stats.get('retry_by_error_type', {})
                retry_stats_str = ""
                if retry_by_type:
                    retry_stats_str = " | Retries by type: "
                    retry_stats_str += ", ".join([f"{k}: {v:,}" for k, v in retry_by_type.items()])

                logger.info(f"   Retry queue: {queue_size:,} remaining | "
                            f"Total retries: {sender_stats['retry_attempts']:,} | "
                            f"Success after retry: {sender_stats['success_after_retry']:,}"
                            f"{retry_stats_str}")
                last_log_time = current_time
                last_queue_size = queue_size

            if queue_size == 0:
                logger.info("✅ Retry queue is empty!")
                break

            # Check if we're making progress
            elapsed_wait = current_time - retry_wait_start
            if elapsed_wait > 300:  # Every 5 minutes
                summary = self.response_recorder.get_summary()
                logger.info(f"   Still processing retries... | "
                            f"Total success: {summary['success']:,} | "
                            f"Failed 429: {summary['failed_429']:,} | "
                            f"Failed Timeout: {summary['failed_timeout']:,} | "
                            f"Failed Other: {summary['failed_other']:,}")
                retry_wait_start = current_time

            time.sleep(5)

        # Stop retry manager
        self.sender.retry_manager.stop()

        # Wait a bit for retry threads to finish
        time.sleep(2)

        # Shutdown executor
        if self.executor:
            self.executor.shutdown(wait=True)

        # Final stats
        total_time = time.time() - campaign_start_time
        avg_tps = total_recipients / total_time if total_time > 0 else 0

        # Get final summary and stats
        final_summary = self.response_recorder.get_summary()
        final_sender_stats = self.sender.get_stats()

        logger.info(f"✅ COMPLETED {self.campaign_name} in {total_time:.1f}s")
        logger.info(f"   📨 Total Phones: {final_summary['total_phones']:,}")
        logger.info(f"   ✅ Success: {final_summary['success']:,}")
        logger.info(f"   ⚠️  Failed 429 (rate limit): {final_summary['failed_429']:,}")
        logger.info(f"   ⏱️  Failed Timeout (max 100 retries): {final_summary['failed_timeout']:,}")
        logger.info(f"   ❌ Failed Other (no retry): {final_summary['failed_other']:,}")
        logger.info(f"   🔄 Total Retry Attempts: {final_sender_stats['retry_attempts']:,}")
        logger.info(f"   ✅ Success After Retry: {final_sender_stats['success_after_retry']:,}")
        logger.info(f"   📊 Max Retries for a Number: {final_sender_stats['max_retries']:,}")
        logger.info(f"   📈 Success Rate: {final_summary['success_rate']:.1f}%")
        logger.info(f"   ⚡ Average TPS: {avg_tps:.1f}")

        # Show retry breakdown by error type
        retry_by_type = final_sender_stats.get('retry_by_error_type', {})
        if retry_by_type:
            logger.info(f"   📋 Retry Breakdown by Error Type:")
            for error_type, count in retry_by_type.items():
                logger.info(f"      {error_type}: {count:,} retries")

        # Show error breakdown
        if final_summary['error_breakdown']:
            logger.info(f"   📋 Error Breakdown:")
            for error_type, count in final_summary['error_breakdown'].items():
                logger.info(f"      {error_type}: {count:,}")

        # Save responses to Excel
        excel_file = self.response_recorder.save_to_excel()
        if excel_file:
            logger.info(f"💾 Responses saved to: {excel_file}")

        # Update campaign status with detailed stats
        self.db.campaigns.update_one(
            {"_id": ObjectId(self.campaign_id)},
            {
                "$set": {
                    "status": "completed",
                    "updatedAt": datetime.now(),
                    "stats.sent": final_summary['success'],
                    "stats.failed_total": final_summary['failed_total'],
                    "stats.failed_429": final_summary['failed_429'],
                    "stats.failed_timeout": final_summary['failed_timeout'],
                    "stats.failed_other": final_summary['failed_other'],
                    "stats.total": final_summary['total_phones'],
                    "stats.total_retries": final_sender_stats['total_retries'],
                    "stats.success_after_retry": final_sender_stats['success_after_retry'],
                    "stats.max_retries": final_sender_stats['max_retries'],
                    "stats.success_rate": final_summary['success_rate'],
                    "stats.processing_time": total_time,
                    "stats.avg_tps": avg_tps,
                    "stats.excel_file": excel_file if excel_file else None,
                    "stats.error_breakdown": final_summary['error_breakdown'],
                    "stats.retry_by_error_type": retry_by_type,
                    "stats.responses_recorded": final_summary['responses_recorded']
                }
            }
        )

        return {
            'sent': final_summary['success'],
            'failed': final_summary['failed_total'],
            'failed_429': final_summary['failed_429'],
            'failed_timeout': final_summary['failed_timeout'],
            'failed_other': final_summary['failed_other']
        }

    def process_batch(self, recipients, batch_num, processed_phones):
        """Process batch with maximum parallelism"""
        futures = []

        # Prepare all tasks
        for i, recipient in enumerate(recipients):
            if self.should_stop:
                break

            phone = recipient.get("recipientPhoneNumber")
            if not phone:
                continue

            # Check if phone already processed (safety check)
            if phone in processed_phones:
                logger.warning(f"⚠️ Phone {phone} already processed, skipping")
                continue

            processed_phones.add(phone)

            # Get or generate message ID
            message_id = None
            for entry in recipient.get("campaigns", []):
                if str(entry.get("campaignId")) == self.campaign_id:
                    message_id = entry.get("messageId")
                    break

            if not message_id:
                message_id = str(uuid.uuid4())

            # Assign thread ID based on position in batch
            thread_id = i % 50  # Distribute across 50 threads

            # Submit task
            future = self.executor.submit(
                self.sender.send_single_message,
                phone,
                self.message_data,
                message_id,
                thread_id
            )
            futures.append(future)

        if not futures:
            return

        # Wait for all to complete
        for future in concurrent.futures.as_completed(futures):
            if self.should_stop:
                break

            try:
                future.result(timeout=15)
            except Exception as e:
                logger.error(f"Error processing phone: {str(e)}")
                pass


class ParallelCampaignsController:
    """Process multiple campaigns in parallel"""

    def __init__(self, max_concurrent_campaigns: int = 5):
        # MongoDB
        mongo_uri = "mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority"
        self.client = MongoClient(mongo_uri, maxPoolSize=100, connectTimeoutMS=10000, socketTimeoutMS=30000)
        self.db = self.client.test

        # Configuration
        self.max_concurrent_campaigns = max_concurrent_campaigns

        # Token manager
        self.token_manager = HighPerformanceTokenManager(
            assistant_id="6917167fa34077bfc4bc519c",
            client_secret="c16bf428-bac7-4015-a90e-afc2393c4f50"
        )

        # Control
        self.should_stop = False
        signal.signal(signal.SIGINT, self.signal_handler)

        # Statistics
        self.stats = {
            'total_campaigns': 0,
            'completed_campaigns': 0,
            'total_sent': 0,
            'total_failed': 0,
            'total_failed_429': 0,
            'total_failed_timeout': 0,
            'total_failed_other': 0,
            'total_retries': 0,
            'success_after_retry': 0,
            'max_retries': 0,
            'start_time': None,
            'excel_files': []
        }

        # Campaign results storage
        self.campaign_results = []

    def signal_handler(self, signum, frame):
        """Handle Ctrl+C"""
        logger.info("\n🛑 Stopping gracefully...")
        self.should_stop = True

    def get_all_pending_campaigns(self):
        """Get ALL pending campaigns"""
        try:
            campaigns = list(self.db.campaigns.find({"status": "pending"}))

            # Filter for bot campaigns
            bot_campaigns = []
            for campaign in campaigns:
                name = campaign.get("name", "")
                if name.startswith("bot") and name[3:].isdigit():
                    bot_num = int(name[3:])
                    if 1 <= bot_num <= 30:
                        bot_campaigns.append(campaign)

            # Sort by name
            bot_campaigns.sort(key=lambda x: x.get("name", ""))

            return bot_campaigns

        except Exception as e:
            logger.error(f"Error getting campaigns: {str(e)}")
            return []

    def verify_credentials(self):
        """Verify credentials"""
        token = self.token_manager.get_token()
        return token is not None

    def process_campaigns_in_parallel(self):
        """Process campaigns in parallel"""
        print(f"\n{'=' * 80}")
        print("🚀 JIO BUSINESS MESSAGING - PARALLEL CAMPAIGN PROCESSOR")
        print("💾 FEATURE: All responses saved to Excel files")
        print("🔄 FEATURE: SMART RETRY POLICIES")
        print(f"{'=' * 80}")
        print(f"🎯 Max Concurrent Campaigns: {self.max_concurrent_campaigns}")
        print(f"🔄 RETRY POLICIES:")
        print(f"  • 429 errors (rate limit): UNLIMITED retries")
        print(f"  • Timeout errors: MAX 100 retries")
        print(f"  • Other errors: NO RETRY (400, 401, 403, 500, etc.)")
        print(f"📋 Processing: bot1 to bot30 (in parallel)")
        print(f"📊 Results saved in: campaign_results/ folder")
        print(f"{'=' * 80}")

        # Verify credentials
        if not self.verify_credentials():
            logger.error("❌ Credentials verification failed!")
            return

        # Get campaigns
        campaigns = self.get_all_pending_campaigns()

        if not campaigns:
            logger.info("📭 No pending campaigns found")
            return

        self.stats['total_campaigns'] = len(campaigns)
        self.stats['start_time'] = time.time()

        logger.info(f"\nFound {len(campaigns)} campaigns, processing {self.max_concurrent_campaigns} at a time...")

        # Process campaigns in batches
        for i in range(0, len(campaigns), self.max_concurrent_campaigns):
            if self.should_stop:
                break

            batch = campaigns[i:i + self.max_concurrent_campaigns]
            logger.info(f"\n📦 Processing batch: {i // self.max_concurrent_campaigns + 1}/"
                        f"{math.ceil(len(campaigns) / self.max_concurrent_campaigns)}")

            # Process this batch in parallel
            self.process_batch_parallel(batch)

            # Update progress
            elapsed = time.time() - self.stats['start_time']
            total_processed = self.stats['total_sent'] + self.stats['total_failed']
            avg_tps = total_processed / elapsed if elapsed > 0 else 0

            logger.info(f"\n📊 OVERALL PROGRESS: {self.stats['completed_campaigns']}/{len(campaigns)} campaigns")
            logger.info(f"   Total Sent: {self.stats['total_sent']:,}")
            logger.info(f"   Total Failed 429: {self.stats['total_failed_429']:,}")
            logger.info(f"   Total Failed Timeout: {self.stats['total_failed_timeout']:,}")
            logger.info(f"   Total Failed Other: {self.stats['total_failed_other']:,}")
            logger.info(f"   Total Retries: {self.stats['total_retries']:,}")
            logger.info(f"   Success After Retry: {self.stats['success_after_retry']:,}")
            logger.info(f"   Max Retries (any number): {self.stats['max_retries']:,}")
            logger.info(f"   Average TPS: {avg_tps:.1f}")
            logger.info(f"   Elapsed Time: {elapsed:.1f}s")

            # Show Excel files created
            if self.stats['excel_files']:
                logger.info(f"   Excel Files: {len(self.stats['excel_files'])} created")

            if i + self.max_concurrent_campaigns < len(campaigns):
                logger.info("⏳ Preparing next batch...")
                time.sleep(2)

        # Final report
        self.display_final_report(campaigns)

        # Display campaign results summary
        self.display_campaign_results_summary()

        # Display Excel files location
        self.display_excel_files_info()

    def process_batch_parallel(self, campaigns):
        """Process a batch of campaigns in parallel"""
        with ThreadPoolExecutor(max_workers=len(campaigns)) as executor:
            # Submit all campaigns
            futures = {}
            for campaign in campaigns:
                processor = UltraFastCampaignProcessor(
                    campaign=campaign,
                    token_manager=self.token_manager,
                    db=self.db
                )
                future = executor.submit(processor.run)
                futures[future] = processor

            # Process results as they complete
            for future in as_completed(futures):
                processor = futures[future]
                campaign_name = processor.campaign_name

                try:
                    result = future.result()

                    with threading.Lock():
                        self.stats['total_sent'] += result['sent']
                        self.stats['total_failed'] += result['failed']
                        self.stats['total_failed_429'] += result['failed_429']
                        self.stats['total_failed_timeout'] += result['failed_timeout']
                        self.stats['total_failed_other'] += result['failed_other']
                        self.stats['completed_campaigns'] += 1

                        # Get sender stats for retry information
                        sender_stats = processor.sender.get_stats()
                        self.stats['total_retries'] += sender_stats['total_retries']
                        self.stats['success_after_retry'] += sender_stats['success_after_retry']
                        self.stats['max_retries'] = max(self.stats['max_retries'],
                                                        sender_stats['max_retries'])

                        # Store campaign result
                        campaign_result = {
                            'name': campaign_name,
                            'sent': result['sent'],
                            'failed_total': result['failed'],
                            'failed_429': result['failed_429'],
                            'failed_timeout': result['failed_timeout'],
                            'failed_other': result['failed_other'],
                            'total': result['sent'] + result['failed'],
                            'retries': sender_stats['total_retries'],
                            'success_after_retry': sender_stats['success_after_retry'],
                            'max_retries': sender_stats['max_retries'],
                            'retry_by_error_type': sender_stats.get('retry_by_error_type', {})
                        }
                        self.campaign_results.append(campaign_result)

                        # Record if Excel file was created
                        if hasattr(processor, 'response_recorder') and processor.response_recorder.responses:
                            self.stats['excel_files'].append(processor.campaign_name)

                    logger.info(f"✓ {campaign_name}:")
                    logger.info(f"    Sent: {result['sent']:,}")
                    logger.info(f"    Failed 429: {result['failed_429']:,}")
                    logger.info(f"    Failed Timeout: {result['failed_timeout']:,}")
                    logger.info(f"    Failed Other: {result['failed_other']:,}")
                    logger.info(f"    Total Retries: {sender_stats['total_retries']:,}")
                    logger.info(f"    Success after retry: {sender_stats['success_after_retry']:,}")
                    logger.info(f"    Max retries: {sender_stats['max_retries']:,}")

                    # Show retry breakdown
                    retry_by_type = sender_stats.get('retry_by_error_type', {})
                    if retry_by_type:
                        retry_str = ", ".join([f"{k}: {v:,}" for k, v in retry_by_type.items()])
                        logger.info(f"    Retry breakdown: {retry_str}")

                except Exception as e:
                    logger.error(f"✗ {campaign_name} failed: {str(e)}")
                    # Store failed campaign result
                    with threading.Lock():
                        campaign_result = {
                            'name': campaign_name,
                            'sent': 0,
                            'failed_total': 0,
                            'failed_429': 0,
                            'failed_timeout': 0,
                            'failed_other': 0,
                            'total': 0,
                            'retries': 0,
                            'success_after_retry': 0,
                            'max_retries': 0,
                            'error': str(e)
                        }
                        self.campaign_results.append(campaign_result)

    def display_final_report(self, campaigns):
        """Display final report"""
        total_time = time.time() - self.stats['start_time']

        print(f"\n{'=' * 80}")
        print("📋 ALL CAMPAIGNS COMPLETED - FINAL REPORT")
        print(f"{'=' * 80}")
        print(f"📨 Total Campaigns: {len(campaigns)}")
        print(f"✅ Total Sent: {self.stats['total_sent']:,}")
        print(f"⚠️  Total Failed 429 (rate limit): {self.stats['total_failed_429']:,}")
        print(f"⏱️  Total Failed Timeout (max 100 retries): {self.stats['total_failed_timeout']:,}")
        print(f"❌ Total Failed Other (no retry): {self.stats['total_failed_other']:,}")
        print(f"🔄 Total Retry Attempts: {self.stats['total_retries']:,}")
        print(f"✅ Success After Retry: {self.stats['success_after_retry']:,}")
        print(f"📊 Max Retries (any number): {self.stats['max_retries']:,}")

        total_messages = self.stats['total_sent'] + self.stats['total_failed']
        if total_messages > 0:
            success_rate = (self.stats['total_sent'] / total_messages) * 100
            print(f"📈 Overall Success Rate: {success_rate:.1f}%")

            if self.stats['total_retries'] > 0:
                retry_success_rate = (self.stats['success_after_retry'] / self.stats['total_retries'] * 100) if \
                    self.stats['total_retries'] > 0 else 0
                print(f"📈 Retry Success Rate: {retry_success_rate:.1f}%")

        if total_time > 0:
            avg_tps = total_messages / total_time
            print(f"⚡ Average TPS: {avg_tps:.1f}")
            print(f"⏱️  Total Time: {total_time:.1f}s")

        print(f"💾 Excel Files: {len(self.stats['excel_files'])} campaigns' responses saved")
        print(f"{'=' * 80}")

    def display_campaign_results_summary(self):
        """Display summary of all campaign results"""
        if not self.campaign_results:
            return

        print(f"\n{'=' * 80}")
        print("📊 CAMPAIGN-BY-CAMPAIGN RESULTS SUMMARY")
        print(f"{'=' * 80}")

        # Sort by campaign name
        self.campaign_results.sort(key=lambda x: x['name'])

        total_sent = 0
        total_failed_429 = 0
        total_failed_timeout = 0
        total_failed_other = 0
        total_retries = 0
        total_success_after_retry = 0
        max_retries_overall = 0

        print(
            f"{'Campaign':<10} {'Total':<10} {'Sent':<10} {'Failed':<10} {'429':<10} {'Timeout':<10} {'Other':<10} {'Retries':<10} {'Retry Success':<12} {'Max Retry':<10}")
        print(
            f"{'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 12} {'-' * 10}")

        for result in self.campaign_results:
            name = result['name']
            total = result['total']
            sent = result['sent']
            failed_total = result['failed_total']
            failed_429 = result['failed_429']
            failed_timeout = result['failed_timeout']
            failed_other = result['failed_other']
            retries = result['retries']
            retry_success = result['success_after_retry']
            max_retries = result['max_retries']

            total_sent += sent
            total_failed_429 += failed_429
            total_failed_timeout += failed_timeout
            total_failed_other += failed_other
            total_retries += retries
            total_success_after_retry += retry_success
            max_retries_overall = max(max_retries_overall, max_retries)

            print(
                f"{name:<10} {total:<10,} {sent:<10,} {failed_total:<10,} {failed_429:<10,} {failed_timeout:<10,} {failed_other:<10,} {retries:<10,} {retry_success:<12,} {max_retries:<10,}")

        print(
            f"{'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 12} {'-' * 10}")

        total_failed = total_failed_429 + total_failed_timeout + total_failed_other
        total = total_sent + total_failed
        overall_success_rate = (total_sent / total * 100) if total > 0 else 0

        print(
            f"{'TOTAL':<10} {total:<10,} {total_sent:<10,} {total_failed:<10,} {total_failed_429:<10,} {total_failed_timeout:<10,} {total_failed_other:<10,} {total_retries:<10,} {total_success_after_retry:<12,} {max_retries_overall:<10,}")

        print(f"\n📊 KEY STATISTICS:")
        print(f"   Overall Success Rate: {overall_success_rate:.1f}%")
        print(f"   Numbers with 429 errors: {total_failed_429:,} (unlimited retries)")
        print(f"   Numbers with timeout errors: {total_failed_timeout:,} (max 100 retries)")
        print(f"   Numbers with other errors: {total_failed_other:,} (no retry)")

        if total_retries > 0:
            retry_success_rate = (total_success_after_retry / total_retries * 100) if total_retries > 0 else 0
            print(f"   Retry Success Rate: {retry_success_rate:.1f}%")
            print(f"   Max retries for any number: {max_retries_overall:,}")

        print(f"\n⚠️  RETRY POLICIES APPLIED:")
        print(f"   • 429 errors: UNLIMITED retries (rate limit)")
        print(f"   • Timeout errors: MAX 100 retries")
        print(f"   • Other errors: NO RETRY (400, 401, 403, 500, etc.)")
        print(f"{'=' * 80}")

    def display_excel_files_info(self):
        """Display information about created Excel files"""
        try:
            campaigns = list(self.db.campaigns.find(
                {"status": "completed", "name": {"$regex": "^bot"}}
            ).sort("name", 1))

            print(f"\n📁 EXCEL FILES CREATED:")
            print(f"{'-' * 80}")

            for campaign in campaigns:
                name = campaign.get("name", "Unknown")
                stats = campaign.get("stats", {})
                excel_file = stats.get("excel_file")

                if excel_file:
                    print(f"{name}: {excel_file}")
                else:
                    print(f"{name}: No responses recorded")

            print(f"{'-' * 80}")
            print(f"📂 All files are saved in: campaign_results/ folder")
            print(f"📊 Each file contains detailed information including:")
            print(f"   - Phone numbers")
            print(f"   - Status (success/failed)")
            print(f"   - Response codes")
            print(f"   - Error messages")
            print(f"   - Error type (success, 429_rate_limit, timeout, http_400, etc.)")
            print(f"   - Retry counts")
            print(f"   - Timestamps (sorted by phone then time)")
            print(f"{'-' * 80}")

        except Exception as e:
            logger.error(f"Error displaying Excel files info: {str(e)}")

    def run(self):
        """Main processing loop"""
        try:
            self.process_campaigns_in_parallel()
        finally:
            try:
                self.client.close()
                logger.info("MongoDB connection closed")
            except:
                pass


def main():
    """Main function"""
    try:
        print("\n" + "=" * 80)
        print("🚀 JIO BUSINESS MESSAGING CAMPAIGN PROCESSOR")
        print("💾 WITH EXCEL RESPONSE EXPORT")
        print("🔄 SMART RETRY POLICIES")
        print("=" * 80)

        # Configuration
        max_concurrent = 50

        try:
            max_concurrent = int(input(f"Max concurrent campaigns [{max_concurrent}]: ") or max_concurrent)
        except:
            print("Using default values")

        print(f"\nConfiguration:")
        print(f"  Max Concurrent Campaigns: {max_concurrent}")
        print(f"\n🔄 RETRY POLICIES:")
        print(f"  • 429 errors (rate limit): UNLIMITED retries")
        print(f"  • Timeout errors: MAX 100 retries")
        print(f"  • Other errors: NO RETRY (400, 401, 403, 500, etc.)")
        print(f"\n📊 Data Export:")
        print(f"  All responses saved to campaign_results/ folder")
        print(f"  Each campaign's responses saved in separate Excel file")
        print(f"  Detailed error tracking and reporting")
        print(f"\n✅ GUARANTEES:")
        print(f"  ✓ No numbers will be skipped")
        print(f"  ✓ Every number will be attempted")
        print(f"  ✓ Smart retry policies based on error type")
        print(f"  ✓ Complete error tracking with proper classifications")
        print(f"\n⚠️ Press Ctrl+C to stop at any time")
        print("=" * 80)

        # Run processor
        controller = ParallelCampaignsController(
            max_concurrent_campaigns=max_concurrent
        )
        controller.run()

    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    # Install required packages if not installed
    try:
        import pandas
        import openpyxl
    except ImportError:
        print("\n📦 Installing required packages...")
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas", "openpyxl"])
        print("✅ Packages installed successfully!\n")

    main()