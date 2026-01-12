#!/bin/bash

# Remove all message.model imports and replace with empty lines
find src/ -name "*.js" -exec sed -i 's/.*message\.model.*//g' {} \;

# Remove ContactCampaignMessage imports that reference message.model
find src/ -name "*.js" -exec sed -i 's/.*ContactCampaignMessage.*import.*message\.model.*//g' {} \;

echo "Fixed all message.model imports"