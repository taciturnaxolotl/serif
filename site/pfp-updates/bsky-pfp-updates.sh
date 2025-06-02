#!/usr/bin/env bash

# Dynamic Profile Picture Updater
# Automatically updates your profile pictures across platforms based on time and weather
# Usage: ./auto_pfp.sh [options]

set -euo pipefail

# Default configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.json"
IMAGES_DIR="${SCRIPT_DIR}/rendered_timelines"
LOG_FILE="${SCRIPT_DIR}/auto_pfp.log"
SESSION_FILE="${SCRIPT_DIR}/.bluesky_session"
DEFAULT_TIMELINE="sunny"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} - ${level} - ${message}" | tee -a "$LOG_FILE" >&2
}

log_info() { log "${BLUE}[INFO]${NC}" "$@"; }
log_success() { log "${GREEN}[SUCCESS]${NC}" "$@"; }
log_warning() { log "${YELLOW}[WARNING]${NC}" "$@"; }
log_error() { log "${RED}[ERROR]${NC}" "$@"; }

# Check dependencies
check_dependencies() {
    local missing_deps=()

    if ! command -v curl &> /dev/null; then
        missing_deps+=("curl")
    fi

    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi
    
    if ! command -v sha256sum &> /dev/null; then
        missing_deps+=("sha256sum")
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing required dependencies:"
        for dep in "${missing_deps[@]}"; do
            echo "  - $dep"
        done
        exit 1
    fi
}

# Create default config file
create_default_config() {
    cat > "$CONFIG_FILE" << 'EOF'
{
  "platforms": {
    "bluesky": {
      "enabled": true,
      "handle": "your-handle.bsky.social",
      "password": "your-app-password"
    },
    "slack": {
      "enabled": false,
      "user_token": ""
    }
  },
  "weather": {
    "enabled": false,
    "api_key": "",
    "location": "auto",
    "timeline_mapping": {
      "clear": "sunny",
      "clouds": "cloudy",
      "rain": "rainy",
      "drizzle": "rainy",
      "thunderstorm": "stormy",
      "snow": "snowy",
      "mist": "cloudy",
      "fog": "cloudy"
    }
  },
  "settings": {
    "default_timeline": "sunny",
    "images_dir": "./rendered_timelines"
  }
}
EOF
    log_info "Created default config file: $CONFIG_FILE"
    log_warning "Please edit the config file with your platform credentials"
}

# Load configuration
load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        log_warning "Config file not found, creating default..."
        create_default_config
        exit 1
    fi

    # Read platform settings
    BLUESKY_ENABLED=$(jq -r '.platforms.bluesky.enabled' "$CONFIG_FILE")
    BLUESKY_HANDLE=$(jq -r '.platforms.bluesky.handle' "$CONFIG_FILE")
    BLUESKY_PASSWORD=$(jq -r '.platforms.bluesky.password' "$CONFIG_FILE")
    SLACK_ENABLED=$(jq -r '.platforms.slack.enabled' "$CONFIG_FILE")
    SLACK_USER_TOKEN=$(jq -r '.platforms.slack.user_token' "$CONFIG_FILE")

    # Read weather settings
    WEATHER_ENABLED=$(jq -r '.weather.enabled' "$CONFIG_FILE")
    WEATHER_API_KEY=$(jq -r '.weather.api_key' "$CONFIG_FILE")
    WEATHER_LOCATION=$(jq -r '.weather.location' "$CONFIG_FILE")

    # Read general settings
    DEFAULT_TIMELINE=$(jq -r '.settings.default_timeline' "$CONFIG_FILE")
    IMAGES_DIR=$(jq -r '.settings.images_dir' "$CONFIG_FILE")

    # Validate at least one platform is enabled and configured
    local enabled_platforms=()

    # Check Bluesky
    if [ "$BLUESKY_ENABLED" = "true" ]; then
        if [ "$BLUESKY_HANDLE" = "your-handle.bsky.social" ] || [ "$BLUESKY_HANDLE" = "null" ] || [ -z "$BLUESKY_HANDLE" ]; then
            log_warning "Bluesky enabled but handle not configured - will be skipped"
            BLUESKY_ENABLED="false"
        elif [ "$BLUESKY_PASSWORD" = "your-app-password" ] || [ "$BLUESKY_PASSWORD" = "null" ] || [ -z "$BLUESKY_PASSWORD" ]; then
            log_warning "Bluesky enabled but password not configured - will be skipped"
            BLUESKY_ENABLED="false"
        else
            enabled_platforms+=("Bluesky")
        fi
    fi

    # Check Slack
    if [ "$SLACK_ENABLED" = "true" ]; then
        if [ -z "$SLACK_USER_TOKEN" ] || [ "$SLACK_USER_TOKEN" = "null" ]; then
            log_warning "Slack enabled but no user token provided - will be skipped"
            SLACK_ENABLED="false"
        else
            enabled_platforms+=("Slack")
        fi
    fi

    # Ensure at least one platform is enabled
    if [ ${#enabled_platforms[@]} -eq 0 ]; then
        log_error "No platforms are properly configured. Please check your config file."
        exit 1
    fi

    # Convert relative paths to absolute
    if [[ ! "$IMAGES_DIR" =~ ^/ ]]; then
        IMAGES_DIR="${SCRIPT_DIR}/${IMAGES_DIR}"
    fi

    log_info "Loaded configuration with enabled platforms: ${enabled_platforms[*]}"
}

# Authenticate with Bluesky
authenticate_bluesky() {
    if [ "$BLUESKY_ENABLED" != "true" ]; then
        return 1
    fi

    log_info "Authenticating with Bluesky..."

    local auth_response
    auth_response=$(curl -s -X POST \
        "https://bsky.social/xrpc/com.atproto.server.createSession" \
        -H "Content-Type: application/json" \
        -d "{\"identifier\":\"$BLUESKY_HANDLE\",\"password\":\"$BLUESKY_PASSWORD\"}")

    if echo "$auth_response" | jq -e '.accessJwt' > /dev/null 2>&1; then
        echo "$auth_response" > "$SESSION_FILE"
        log_success "Successfully authenticated with Bluesky"
        return 0
    else
        log_error "Bluesky authentication failed: $(echo "$auth_response" | jq -r '.message // "Unknown error"')"
        return 1
    fi
}

# Get session token
get_session_token() {
    if [ ! -f "$SESSION_FILE" ]; then
        return 1
    fi

    # Check if session is still valid (sessions typically last 24 hours)
    local session_age=$(($(date +%s) - $(stat -c %Y "$SESSION_FILE" 2>/dev/null || echo 0)))
    if [ $session_age -gt 86400 ]; then  # 24 hours
        log_info "Session expired, re-authenticating..."
        rm -f "$SESSION_FILE"
        return 1
    fi

    jq -r '.accessJwt' "$SESSION_FILE" 2>/dev/null || return 1
}

# Calculate SHA256 hash of image file
calculate_image_hash() {
    local image_path="$1"
    if [ ! -f "$image_path" ]; then
        return 1
    fi
    sha256sum "$image_path" | cut -d' ' -f1
}

# Get blob reference from ATProto record
get_cached_blob() {
    local weather_type="$1"
    local hour="$2"
    local image_hash="$3"
    local token="$4"
    local did
    
    did=$(jq -r '.did' "$SESSION_FILE")
    local rkey="${weather_type}_hour_${hour}"
    
    # Validate DID
    if [ -z "$did" ] || [ "$did" = "null" ]; then
        log_error "Could not get DID from session file"
        return 1
    fi
    
    log_info "Checking for cached blob: $weather_type hour $hour (DID: ${did:0:20}...)"
    
    # Try to get existing record
    local record_response
    record_response=$(curl -s \
        "https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=$did&collection=pfp.updates.${weather_type}&rkey=$rkey" \
        -H "Authorization: Bearer $token")
    
    if echo "$record_response" | jq -e '.value' > /dev/null 2>&1; then
        local stored_hash=$(echo "$record_response" | jq -r '.value.imageHash // empty')
        local stored_blob=$(echo "$record_response" | jq -c '.value.blobRef // empty')
        
        if [ "$stored_hash" = "$image_hash" ] && [ -n "$stored_blob" ] && [ "$stored_blob" != "empty" ]; then
            log_success "Found cached blob with matching hash"
            echo "$stored_blob"
            return 0
        else
            log_info "Cached blob found but hash mismatch or missing blob reference"
            return 1
        fi
    else
        log_info "No cached blob record found"
        return 1
    fi
}

# Store blob reference in ATProto record
store_blob_reference() {
    local weather_type="$1"
    local hour="$2"
    local image_hash="$3"
    local blob_ref="$4"
    local token="$5"
    local did
    
    did=$(jq -r '.did' "$SESSION_FILE")
    local rkey="${weather_type}_hour_${hour}"
    
    # Validate DID
    if [ -z "$did" ] || [ "$did" = "null" ]; then
        log_error "Could not get DID from session file"
        return 1
    fi
    
    log_info "Storing blob reference for $weather_type hour $hour (DID: ${did:0:20}...)"
    
    # Create record data
    local record_data
    record_data=$(jq -n \
        --arg type_field "pfp.updates.${weather_type}" \
        --arg hash "$image_hash" \
        --argjson blob "$blob_ref" \
        --arg weather "$weather_type" \
        --arg hour "$hour" \
        --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
        '{
            "$type": $type_field,
            "timeline": $weather,
            "hour": $hour,
            "imageHash": $hash,
            "blobRef": $blob,
            "createdAt": $timestamp
        }')
    
    log_info "Record data: $record_data"
    
    # Create the request payload using direct JSON construction
    local request_payload
    request_payload=$(jq -n \
        --arg repo "$did" \
        --arg collection "pfp.updates.${weather_type}" \
        --arg rkey "$rkey" \
        --argjson record "$record_data" \
        '{
            "repo": $repo,
            "collection": $collection,
            "rkey": $rkey,
            "record": $record
        }')
    
    log_info "Request payload preview: $(echo "$request_payload" | jq -c '.' | head -c 200)..."
    
    # Validate the payload has required fields
    if ! echo "$request_payload" | jq -e '.repo' > /dev/null 2>&1; then
        log_error "Request payload missing 'repo' field"
        log_error "DID value: '$did'"
        log_error "Full payload: $request_payload"
        return 1
    fi
    
    # In dry run mode, don't actually store
    if [ "${DRY_RUN:-false}" = "true" ]; then
        log_info "DRY RUN MODE - Would store blob reference"
        return 0
    fi
    
    # Store the record
    local store_response
    store_response=$(curl -s -X POST \
        "https://bsky.social/xrpc/com.atproto.repo.putRecord" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "$request_payload")
    
    if echo "$store_response" | jq -e '.uri' > /dev/null 2>&1; then
        log_success "Successfully stored blob reference"
        return 0
    else
        log_error "Failed to store blob reference: $(echo "$store_response" | jq -r '.message // "Unknown error"')"
        log_error "Full response: $store_response"
        return 1
    fi
}

# Upload image as blob
upload_blob() {
    local image_path="$1"
    local token="$2"

    if [ ! -f "$image_path" ]; then
        log_error "Image file not found: $image_path"
        return 1
    fi

    # Check image file size (should be reasonable)
    local file_size=$(stat -c%s "$image_path" 2>/dev/null || echo 0)
    if [ "$file_size" -lt 1000 ]; then
        log_error "Image file too small ($file_size bytes): $image_path"
        return 1
    fi

    if [ "$file_size" -gt 10000000 ]; then  # 10MB limit
        log_error "Image file too large ($file_size bytes): $image_path"
        return 1
    fi

    log_info "Uploading image: $(basename "$image_path") ($(numfmt --to=iec "$file_size"))"

    local upload_response
    upload_response=$(curl -s -X POST \
        "https://bsky.social/xrpc/com.atproto.repo.uploadBlob" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: image/jpeg" \
        --data-binary "@$image_path")

    if echo "$upload_response" | jq -e '.blob' > /dev/null 2>&1; then
        local blob_result
        blob_result=$(echo "$upload_response" | jq -c '.blob')
        log_success "Successfully uploaded image"
        log_info "Blob data: $blob_result"
        echo "$blob_result"
        return 0
    else
        local error_type=$(echo "$upload_response" | jq -r '.error // "Unknown"')
        local error_msg=$(echo "$upload_response" | jq -r '.message // "Unknown error"')

        if [ "$error_type" = "ExpiredToken" ] || echo "$error_msg" | grep -qi "expired"; then
            log_error "Token has expired - session needs refresh"
            # Remove the expired session file so it will be regenerated
            rm -f "$SESSION_FILE"
            return 2  # Special return code for expired token
        else
            log_error "Failed to upload image: $error_msg"
            log_error "Full response: $upload_response"
            return 1
        fi
    fi
}

# Get or upload blob with caching
get_or_upload_blob() {
    local image_path="$1"
    local weather_type="$2"
    local hour="$3"
    local token="$4"
    
    if [ ! -f "$image_path" ]; then
        log_error "Image file not found: $image_path"
        return 1
    fi
    
    # Calculate image hash
    local image_hash
    image_hash=$(calculate_image_hash "$image_path")
    if [ -z "$image_hash" ]; then
        log_error "Failed to calculate image hash"
        return 1
    fi
    
    log_info "Image hash: $image_hash"
    
    # Try to get cached blob
    local cached_blob
    if cached_blob=$(get_cached_blob "$weather_type" "$hour" "$image_hash" "$token"); then
        log_success "Using cached blob reference"
        echo "$cached_blob"
        return 0
    fi
    
    # No cache hit, upload the blob
    log_info "No valid cache found, uploading new blob..."
    local new_blob
    new_blob=$(upload_blob "$image_path" "$token")
    
    if [ -n "$new_blob" ]; then
        # Store the blob reference for future use
        if store_blob_reference "$weather_type" "$hour" "$image_hash" "$new_blob" "$token"; then
            log_success "Blob uploaded and cached successfully"
        else
            log_warning "Blob uploaded but failed to cache reference"
        fi
        echo "$new_blob"
        return 0
    else
        log_error "Failed to upload blob"
        return 1
    fi
}

# List all cached blobs
list_cached_blobs() {
    local token="$1"
    local did
    
    did=$(jq -r '.did' "$SESSION_FILE")
    
    log_info "Listing cached blob records..."
    
    # Get list of available timelines to check each collection
    local timelines=()
    if [ -d "$IMAGES_DIR" ]; then
        for timeline_dir in "$IMAGES_DIR"/*; do
            if [ -d "$timeline_dir" ]; then
                timelines+=($(basename "$timeline_dir"))
            fi
        done
    fi
    
    local total_records=0
    echo "Cached blob records:"
    
    for timeline in "${timelines[@]}"; do
        # List records in each timeline collection
        local list_response
        list_response=$(curl -s \
            "https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=$did&collection=pfp.updates.${timeline}" \
            -H "Authorization: Bearer $token" 2>/dev/null)
        
        if echo "$list_response" | jq -e '.records' > /dev/null 2>&1; then
            local timeline_count=$(echo "$list_response" | jq '.records | length')
            if [ "$timeline_count" -gt 0 ]; then
                echo "  $timeline timeline:"
                echo "$list_response" | jq -r '.records[] | "    hour \(.value.hour) - Hash: \(.value.imageHash[0:12])... (Created: \(.value.createdAt))"'
                total_records=$((total_records + timeline_count))
            fi
        fi
    done
    
    echo "Total cached records: $total_records"
}

# Clean up old cached blobs (optional maintenance function)
cleanup_cached_blobs() {
    local token="$1"
    local days_to_keep="${2:-30}"  # Keep records for 30 days by default
    local did
    
    did=$(jq -r '.did' "$SESSION_FILE")
    
    log_info "Cleaning up cached blobs older than $days_to_keep days..."
    
    # Get current timestamp minus retention period
    local cutoff_date
    cutoff_date=$(date -u -d "$days_to_keep days ago" +%Y-%m-%dT%H:%M:%S.%3NZ)
    
    # Get list of available timelines to check each collection
    local timelines=()
    if [ -d "$IMAGES_DIR" ]; then
        for timeline_dir in "$IMAGES_DIR"/*; do
            if [ -d "$timeline_dir" ]; then
                timelines+=($(basename "$timeline_dir"))
            fi
        done
    fi
    
    local deleted_count=0
    
    for timeline in "${timelines[@]}"; do
        # List all records in this timeline collection
        local list_response
        list_response=$(curl -s \
            "https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=$did&collection=pfp.updates.${timeline}" \
            -H "Authorization: Bearer $token" 2>/dev/null)
        
        if echo "$list_response" | jq -e '.records' > /dev/null 2>&1; then
            # Find records older than cutoff
            local old_records
            old_records=$(echo "$list_response" | jq --arg cutoff "$cutoff_date" '.records[] | select(.value.createdAt < $cutoff)')
            
            if [ -n "$old_records" ]; then
                echo "$old_records" | jq -r '.uri' | while read -r record_uri; do
                    local rkey=$(echo "$record_uri" | sed 's/.*\///')
                    log_info "Deleting old record: $timeline/$rkey"
                    
                    curl -s -X POST \
                        "https://bsky.social/xrpc/com.atproto.repo.deleteRecord" \
                        -H "Authorization: Bearer $token" \
                        -H "Content-Type: application/json" \
                        -d "{\"repo\":\"$did\",\"collection\":\"pfp.updates.${timeline}\",\"rkey\":\"$rkey\"}" > /dev/null
                    
                    deleted_count=$((deleted_count + 1))
                done
            fi
        fi
    done
    
    if [ "$deleted_count" -eq 0 ]; then
        log_info "No old records found to clean up"
    else
        log_success "Deleted $deleted_count old records"
    fi
}

# Update profile picture
update_profile_picture() {
    local blob_ref="$1"
    local token="$2"
    local did

    # Validate blob reference
    if [ -z "$blob_ref" ] || [ "$blob_ref" = "null" ]; then
        log_error "Invalid blob reference provided"
        return 1
    fi

    # Validate blob reference format
    if ! echo "$blob_ref" | jq -e '.ref' > /dev/null 2>&1; then
        log_error "Blob reference missing required 'ref' field: $blob_ref"
        return 1
    fi

    # Get DID from session
    did=$(jq -r '.did' "$SESSION_FILE")

    log_info "Updating profile picture..."
    log_info "Using blob: $blob_ref"

    # Get current profile
    local current_profile
    current_profile=$(curl -s \
        "https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=$did&collection=app.bsky.actor.profile&rkey=self" \
        -H "Authorization: Bearer $token")

    log_info "Current profile response: $current_profile"

    local profile_data
    if echo "$current_profile" | jq -e '.value' > /dev/null 2>&1; then
        # Update existing profile - PRESERVE ALL EXISTING FIELDS
        profile_data=$(echo "$current_profile" | jq --argjson avatar "$blob_ref" '.value | .avatar = $avatar')
        log_info "Updating existing profile (preserving existing fields)"
    else
        log_error "No existing profile found - cannot safely create new profile"
        log_error "Please manually restore your profile in the Bluesky app first"
        return 1
    fi

    log_info "Profile data to send: $profile_data"

    # Validate profile data before sending
    if ! echo "$profile_data" | jq -e '.avatar' > /dev/null 2>&1; then
        log_error "Generated profile data is invalid"
        return 1
    fi

    # Double-check we're preserving important fields
    local display_name=$(echo "$profile_data" | jq -r '.displayName // empty')
    local description=$(echo "$profile_data" | jq -r '.description // empty')

    if [ -n "$display_name" ]; then
        log_info "Preserving display name: $display_name"
    fi

    if [ -n "$description" ]; then
        log_info "Preserving description: $(echo "$description" | head -c 50)..."
    fi

    # Create the request payload
    local request_payload
    request_payload=$(jq -n \
        --arg repo "$did" \
        --arg collection "app.bsky.actor.profile" \
        --arg rkey "self" \
        --argjson record "$profile_data" \
        '{repo: $repo, collection: $collection, rkey: $rkey, record: $record}')

    log_info "Request payload: $request_payload"

    # In dry run mode, don't actually update
    if [ "${DRY_RUN:-false}" = "true" ]; then
        log_info "DRY RUN MODE - Would send profile update with avatar"
        log_info "DRY RUN MODE - Profile fields would be preserved"
        return 0
    fi

    # Update profile
    local update_response
    update_response=$(curl -s -X POST \
        "https://bsky.social/xrpc/com.atproto.repo.putRecord" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "$request_payload")

    log_info "Update response: $update_response"

    if echo "$update_response" | jq -e '.uri' > /dev/null 2>&1; then
        log_success "Successfully updated profile picture"
        return 0
    else
        log_error "Failed to update profile picture: $(echo "$update_response" | jq -r '.message // "Unknown error"')"
        log_error "Full error response: $update_response"
        return 1
    fi
}

# Update Slack profile picture
update_slack_profile_picture() {
    local image_path="$1"

    if [ "$SLACK_ENABLED" != "true" ] || [ -z "$SLACK_USER_TOKEN" ] || [ "$SLACK_USER_TOKEN" = "null" ]; then
        log_info "Slack integration disabled or not configured"
        return 0
    fi

    if [ ! -f "$image_path" ]; then
        log_error "Image file not found for Slack: $image_path"
        return 1
    fi

    log_info "Updating Slack profile picture..."

    # First, upload the image to Slack
    local upload_response
    upload_response=$(curl -s -X POST \
        "https://slack.com/api/users.setPhoto" \
        -H "Authorization: Bearer $SLACK_USER_TOKEN" \
        -F "image=@$image_path")

    if echo "$upload_response" | jq -e '.ok' > /dev/null 2>&1; then
        local ok_status=$(echo "$upload_response" | jq -r '.ok')
        if [ "$ok_status" = "true" ]; then
            log_success "Successfully updated Slack profile picture"
            return 0
        else
            local error_msg=$(echo "$upload_response" | jq -r '.error // "Unknown error"')
            log_error "Failed to update Slack profile picture: $error_msg"

            # Handle common errors
            case "$error_msg" in
                "invalid_auth")
                    log_error "Invalid Slack token - please check your user token"
                    ;;
                "not_authed")
                    log_error "Authentication failed - token may be expired"
                    ;;
                "missing_scope")
                    log_error "Token missing required scope - needs 'users.profile:write'"
                    ;;
                "too_large")
                    log_error "Image file too large for Slack"
                    ;;
            esac
            return 1
        fi
    else
        log_error "Invalid response from Slack API: $upload_response"
        return 1
    fi
}

# Get weather-based timeline
get_weather_timeline() {
    if [ "$WEATHER_ENABLED" != "true" ] || [ -z "$WEATHER_API_KEY" ] || [ "$WEATHER_API_KEY" = "null" ]; then
        log_info "Weather integration disabled, using default timeline: $DEFAULT_TIMELINE"
        echo "$DEFAULT_TIMELINE"
        return 0
    fi

    log_info "Fetching weather data..."

    local lat lon

    if [ "$WEATHER_LOCATION" = "auto" ]; then
        # Auto-detect location from IP
        local ip_data
        ip_data=$(curl -s "http://ip-api.com/json/" --connect-timeout 10)

        if echo "$ip_data" | jq -e '.lat' > /dev/null 2>&1; then
            lat=$(echo "$ip_data" | jq -r '.lat')
            lon=$(echo "$ip_data" | jq -r '.lon')
            local city=$(echo "$ip_data" | jq -r '.city')
            local country=$(echo "$ip_data" | jq -r '.country')
            log_info "Auto-detected location: $city, $country"
        else
            log_warning "Could not auto-detect location, using default timeline"
            echo "$DEFAULT_TIMELINE"
            return 0
        fi
    else
        # Use provided location (assume it's "lat,lon" or city name)
        if [[ "$WEATHER_LOCATION" =~ ^-?[0-9]+\.?[0-9]*,-?[0-9]+\.?[0-9]*$ ]]; then
            # It's coordinates
            lat=$(echo "$WEATHER_LOCATION" | cut -d',' -f1)
            lon=$(echo "$WEATHER_LOCATION" | cut -d',' -f2)
        else
            # It's a city name, geocode it
            local geocode_response
            geocode_response=$(curl -s "http://api.openweathermap.org/geo/1.0/direct?q=$WEATHER_LOCATION&limit=1&appid=$WEATHER_API_KEY")

            if echo "$geocode_response" | jq -e '.[0].lat' > /dev/null 2>&1; then
                lat=$(echo "$geocode_response" | jq -r '.[0].lat')
                lon=$(echo "$geocode_response" | jq -r '.[0].lon')
                log_info "Geocoded location: $WEATHER_LOCATION"
            else
                log_warning "Could not geocode location: $WEATHER_LOCATION"
                echo "$DEFAULT_TIMELINE"
                return 0
            fi
        fi
    fi

    # Get current weather
    local weather_response
    weather_response=$(curl -s "http://api.openweathermap.org/data/2.5/weather?lat=$lat&lon=$lon&appid=$WEATHER_API_KEY" --connect-timeout 10)

    if echo "$weather_response" | jq -e '.weather[0].main' > /dev/null 2>&1; then
        local weather_main=$(echo "$weather_response" | jq -r '.weather[0].main' | tr '[:upper:]' '[:lower:]')
        local weather_desc=$(echo "$weather_response" | jq -r '.weather[0].description')
        log_info "Current weather: $weather_desc"

        # Map weather to timeline
        local timeline
        timeline=$(jq -r ".weather.timeline_mapping.\"$weather_main\" // \"$DEFAULT_TIMELINE\"" "$CONFIG_FILE")

        # Check if the mapped timeline exists
        if [ ! -d "$IMAGES_DIR/$timeline" ]; then
            log_warning "Timeline '$timeline' not found, falling back to default: $DEFAULT_TIMELINE"
            echo "$DEFAULT_TIMELINE"
        else
            log_info "Weather mapped to timeline: $timeline"
            echo "$timeline"
        fi
    else
        log_warning "Could not fetch weather data, using default timeline"
        echo "$DEFAULT_TIMELINE"
    fi
}

# Get current hour image path
get_hour_image_path() {
    local timeline="$1"
    local hour=$(date +%H)
    # Remove leading zero to avoid octal interpretation, then pad with zero
    local hour_decimal=$((10#$hour))  # Force decimal interpretation
    local hour_padded=$(printf "%02d" "$hour_decimal")
    local image_path="$IMAGES_DIR/$timeline/hour_${hour_padded}.jpg"

    if [ -f "$image_path" ]; then
        echo "$image_path"
        return 0
    else
        log_warning "Image not found: $image_path" >&2

        # Try fallback to default timeline
        if [ "$timeline" != "$DEFAULT_TIMELINE" ]; then
            local fallback_path="$IMAGES_DIR/$DEFAULT_TIMELINE/hour_${hour_padded}.jpg"
            if [ -f "$fallback_path" ]; then
                log_info "Using fallback image: $fallback_path" >&2
                echo "$fallback_path"
                return 0
            fi
        fi

        return 1
    fi
}

# List available timelines
list_timelines() {
    if [ ! -d "$IMAGES_DIR" ]; then
        log_error "Images directory not found: $IMAGES_DIR"
        return 1
    fi

    echo "Available timelines:"
    for timeline_dir in "$IMAGES_DIR"/*; do
        if [ -d "$timeline_dir" ]; then
            local timeline_name=$(basename "$timeline_dir")
            local image_count=$(find "$timeline_dir" -name "hour_*.jpg" | wc -l)
            echo "  - $timeline_name ($image_count images)"
        fi
    done
}

# Test mode - show what would be used
test_mode() {
    local timeline
    timeline=$(get_weather_timeline)

    local image_path
    image_path=$(get_hour_image_path "$timeline")

    local hour=$(date +%H)

    echo "=== Test Mode ==="
    echo "Current time: $(date)"
    echo "Current hour: $hour"
    echo "Weather enabled: $WEATHER_ENABLED"
    echo "Selected timeline: $timeline"
    echo "Image path: $image_path"

    if [ -f "$image_path" ]; then
        echo "✓ Image exists"
        echo "Image size: $(du -h "$image_path" | cut -f1)"
        
        # Show hash info in test mode
        local test_hash=$(calculate_image_hash "$image_path")
        echo "Image hash: $test_hash"
    else
        echo "✗ Image not found"

        # Show available alternatives
        echo ""
        echo "Available timelines:"
        list_timelines
        return 1
    fi

    # Show weather info if enabled
    if [ "$WEATHER_ENABLED" = "true" ] && [ -n "$WEATHER_API_KEY" ] && [ "$WEATHER_API_KEY" != "null" ]; then
        echo ""
        echo "Weather integration: enabled"
        echo "Location setting: $WEATHER_LOCATION"
    else
        echo ""
        echo "Weather integration: disabled (using default timeline)"
    fi

    # Show platform info
    echo ""
    echo "Enabled platforms:"
    if [ "$BLUESKY_ENABLED" = "true" ]; then
        echo "  ✓ Bluesky ($BLUESKY_HANDLE)"
    else
        echo "  ✗ Bluesky (disabled or not configured)"
    fi

    if [ "$SLACK_ENABLED" = "true" ]; then
        echo "  ✓ Slack"
    else
        echo "  ✗ Slack (disabled or not configured)"
    fi
    
    # Show caching info
    echo ""
    echo "Blob caching: enabled for Bluesky uploads"
    local hour_decimal=$((10#$hour))
    local hour_padded=$(printf "%02d" "$hour_decimal")
    echo "Cache key would be: ${timeline}_hour_${hour_padded}"
}

# Modified update_pfp function to use caching
update_pfp() {
    log_info "Starting profile picture update..."

    # Determine timeline based on weather
    local timeline
    timeline=$(get_weather_timeline)
    log_info "Using timeline: $timeline"

    # Get appropriate image for current hour
    local image_path
    image_path=$(get_hour_image_path "$timeline")

    if [ -z "$image_path" ]; then
        log_error "No suitable image found for current time"
        return 1
    fi

    log_info "Selected image: $image_path"

    # Get current hour for caching
    local current_hour=$(date +%H)
    local hour_decimal=$((10#$current_hour))
    local hour_padded=$(printf "%02d" "$hour_decimal")

    # Dry run mode - don't actually upload
    if [ "${DRY_RUN:-false}" = "true" ]; then
        log_info "DRY RUN MODE - Would upload: $image_path"
        log_info "Image size: $(stat -c%s "$image_path" 2>/dev/null | numfmt --to=iec)"
        local test_hash=$(calculate_image_hash "$image_path")
        log_info "Image hash: $test_hash"
        log_info "Would cache as: $timeline hour $hour_padded"
        if [ "$BLUESKY_ENABLED" = "true" ]; then
            log_info "DRY RUN MODE - Would update Bluesky profile"
        fi
        if [ "$SLACK_ENABLED" = "true" ]; then
            log_info "DRY RUN MODE - Would update Slack profile"
        fi
        log_info "DRY RUN MODE - No changes made"
        return 0
    fi

    local bluesky_success=false
    local slack_success=false

    # Update Bluesky with caching
    if [ "$BLUESKY_ENABLED" = "true" ]; then
        log_info "Updating Bluesky profile picture with caching..."

        # Get session token
        local token
        token=$(get_session_token)

        if [ -z "$token" ] || [ "$token" = "null" ]; then
            log_info "No valid session found, authenticating..."
            if ! authenticate_bluesky; then
                log_error "Failed to authenticate with Bluesky"
            else
                token=$(get_session_token)
            fi
        fi

        if [ -n "$token" ] && [ "$token" != "null" ]; then
            # Get or upload blob with caching
            local blob_ref
            blob_ref=$(get_or_upload_blob "$image_path" "$timeline" "$hour_padded" "$token")

            # If operation failed due to expired token, try re-authenticating once
            if [ -z "$blob_ref" ]; then
                log_info "Failed to get blob, trying to re-authenticate..."
                rm -f "$SESSION_FILE"  # Remove expired session
                if authenticate_bluesky; then
                    token=$(get_session_token)
                    if [ -n "$token" ] && [ "$token" != "null" ]; then
                        blob_ref=$(get_or_upload_blob "$image_path" "$timeline" "$hour_padded" "$token")
                    fi
                fi
            fi

            if [ -n "$blob_ref" ]; then
                # Update profile picture
                if update_profile_picture "$blob_ref" "$token"; then
                    bluesky_success=true
                fi
            fi
        else
            log_error "Could not obtain valid Bluesky session token"
        fi
    fi

    # Update Slack (independent of Bluesky success)
    if [ "$SLACK_ENABLED" = "true" ]; then
        if update_slack_profile_picture "$image_path"; then
            slack_success=true
        fi
    fi

    # Report results
    local updated_services=()
    local failed_services=()

    if [ "$BLUESKY_ENABLED" = "true" ]; then
        if [ "$bluesky_success" = "true" ]; then
            updated_services+=("Bluesky")
        else
            failed_services+=("Bluesky")
        fi
    fi

    if [ "$SLACK_ENABLED" = "true" ]; then
        if [ "$slack_success" = "true" ]; then
            updated_services+=("Slack")
        else
            failed_services+=("Slack")
        fi
    fi

    # Final status
    if [ ${#updated_services[@]} -gt 0 ]; then
        log_success "Successfully updated: ${updated_services[*]}"
    fi

    if [ ${#failed_services[@]} -gt 0 ]; then
        log_error "Failed to update: ${failed_services[*]}"
    fi

    # Return success if at least one service updated
    if [ ${#updated_services[@]} -gt 0 ]; then
        return 0
    else
        return 1
    fi
}

# Show help
show_help() {
    cat << EOF
Dynamic Profile Picture Updater

Automatically updates your profile pictures across multiple platforms based on time and weather.
Uses ATProto record caching to avoid re-uploading identical images.

Usage: $0 [options]

Options:
    -c, --config FILE       Use custom config file (default: $CONFIG_FILE)
    -t, --test             Test mode - show what would be used without updating
    -d, --dry-run          Dry run - authenticate and prepare but don't actually update
    -l, --list             List available timelines
    -f, --force TIMELINE   Force use of specific timeline (ignore weather)
    --list-cache           List all cached blob references
    --cleanup-cache [DAYS] Clean up cached blobs older than DAYS (default: 30)
    --clear-cache          Delete all cached blob references (USE WITH CAUTION)
    -h, --help             Show this help message

Configuration:
    Edit $CONFIG_FILE to set your platform credentials and preferences.
    
    Supported platforms:
    - Bluesky: Set handle and app password
    - Slack: Set user token (xoxp-...) with users.profile:write scope
    
    Blob Caching:
    Images are uploaded once and cached in ATProto records at:
    pfp.updates.{timeline}.{timeline}_hour_{HH}
    
    Each record contains:
    - Image SHA256 hash for change detection
    - Blob reference for reuse
    - Metadata (timeline, hour, creation time)
    
    Examples of cache locations:
    - pfp.updates.sunny.sunny_hour_09
    - pfp.updates.rainy.rainy_hour_14
    - pfp.updates.cloudy.cloudy_hour_23
    
Examples:
    $0                     # Update profile pictures (uses cache when possible)
    $0 --test              # Test what would be used
    $0 --list-cache        # Show all cached blob references
    $0 --cleanup-cache 7   # Remove cached blobs older than 7 days
    $0 --force sunny       # Force sunny timeline

For automated updates, add to crontab:
    # Update 2 minutes after every hour
    2 * * * * $0 >/dev/null 2>&1
EOF
}

# Parse command line arguments
parse_args() {
    FORCE_TIMELINE=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            -c|--config)
                CONFIG_FILE="$2"
                shift 2
                ;;
            -t|--test)
                load_config
                test_mode
                exit $?
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -l|--list)
                load_config
                list_timelines
                exit 0
                ;;
            -f|--force)
                FORCE_TIMELINE="$2"
                shift 2
                ;;
            --list-cache)
                load_config
                check_dependencies
                
                # Get session token
                local token
                token=$(get_session_token)
                if [ -z "$token" ] || [ "$token" = "null" ]; then
                    if ! authenticate_bluesky; then
                        log_error "Failed to authenticate with Bluesky"
                        exit 1
                    else
                        token=$(get_session_token)
                    fi
                fi
                
                list_cached_blobs "$token"
                exit $?
                ;;
            --cleanup-cache)
                local cleanup_days="30"
                if [[ "$2" =~ ^[0-9]+$ ]]; then
                    cleanup_days="$2"
                    shift
                fi
                
                load_config
                check_dependencies
                
                # Get session token
                local token
                token=$(get_session_token)
                if [ -z "$token" ] || [ "$token" = "null" ]; then
                    if ! authenticate_bluesky; then
                        log_error "Failed to authenticate with Bluesky"
                        exit 1
                    else
                        token=$(get_session_token)
                    fi
                fi
                
                cleanup_cached_blobs "$token" "$cleanup_days"
                exit $?
                ;;
            --clear-cache)
                echo "WARNING: This will delete ALL cached blob references!"
                echo "You will need to re-upload all images on next use."
                read -p "Are you sure? (y/N): " -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    load_config
                    check_dependencies
                    
                    # Get session token
                    local token
                    token=$(get_session_token)
                    if [ -z "$token" ] || [ "$token" = "null" ]; then
                        if ! authenticate_bluesky; then
                            log_error "Failed to authenticate with Bluesky"
                            exit 1
                        else
                            token=$(get_session_token)
                        fi
                    fi
                    
                    cleanup_cached_blobs "$token" "0"  # Delete all
                    log_success "Cache cleared"
                else
                    log_info "Cache clear cancelled"
                fi
                exit 0
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Override weather function if timeline is forced
if [ -n "${FORCE_TIMELINE:-}" ]; then
    get_weather_timeline() {
        echo "$FORCE_TIMELINE"
    }
fi

# Main execution
main() {
    parse_args "$@"
    check_dependencies
    load_config

    if ! update_pfp; then
        exit 1
    fi
}

# Run main function
main "$@"
