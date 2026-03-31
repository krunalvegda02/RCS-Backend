#!/bin/bash

echo "🔍 Searching for campaign threshold logic..."

# Search for numbers that might be thresholds
echo "Searching for '100':"
grep -r "100" /Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND/src/ --include="*.js" -n

echo -e "\nSearching for 'kafka' with numbers:"
grep -r -i "kafka.*[0-9]" /Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND/src/ --include="*.js" -n

echo -e "\nSearching for 'manual' or 'direct':"
grep -r -i "manual\|direct" /Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND/src/ --include="*.js" -n

echo -e "\nSearching for 'insertMany' vs 'sendBatch':"
grep -r -i "insertMany\|sendBatch" /Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND/src/ --include="*.js" -n