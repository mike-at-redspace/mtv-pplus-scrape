#!/bin/bash
inputFilePath="cc-clips.csv"
outputFilePath="output.csv"
apiUrlBase="https://neutron-api.paramount.tech/api/3.4/property"

# Function to extract shortId from URL
extractShortId() {
    url="$1"
    shortId=$(echo "$url" | awk -F'/' '{print $(NF-1)}')
    echo "$shortId"
}

# Function to fetch data from API
fetchData() {
    shortId="$1"
    apiUrl="${apiUrlBase}?platform=web&brand=cc&region=US&version=4.5&shortId=${shortId}&type=showvideo"
    
    headers=(
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        "accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
        "accept-language: en-US,en;q=0.9"
        "cache-control: no-cache"
        "pragma: no-cache"
        "priority: u=0, i"
        "sec-ch-ua: \"Chromium\";v=\"91\", \"Google Chrome\";v=\"91\", \" Not;A\";v=\"99\""
        "sec-ch-ua-mobile: ?0"
        "sec-ch-ua-platform: \"Windows\""
        "sec-fetch-dest: document"
        "sec-fetch-mode: navigate"
        "sec-fetch-site: none"
        "sec-fetch-user: ?1"
        "upgrade-insecure-requests: 1"
    )
    
    response=$(curl -s -X GET "$apiUrl" -H "${headers[@]}")

    # Check if response is a valid JSON
    if ! jq -e . >/dev/null 2>&1 <<<"$response"; then
        echo "Invalid JSON response for $shortId:"
        echo "$response"
        exit 1
    fi

    # Parse JSON and extract required fields
    title=$(echo "$response" | jq -r '.data.item.title')
    seasonNumber=$(echo "$response" | jq -r '.data.item.seasonNumber // ""')
    episodeNumber=$(echo "$response" | jq -r '.data.item.episodeNumber // ""')

    if [[ -z "$title" || -z "$seasonNumber" || -z "$episodeNumber" ]]; then
        echo "Error parsing JSON response for $shortId:"
        echo "$response"
        exit 1
    fi

    echo "$response"
}


# Process CSV
if [[ ! -f "$inputFilePath" ]]; then
    echo "Input file does not exist!" >&2
    exit 1
fi

results=()

# Skip the header row
tail -n +2 "$inputFilePath" | while IFS=, read -r URL _; do
    if [[ -n "$URL" ]]; then
    
        shortId=$(extractShortId "$URL")
        data=$(fetchData "$shortId")
        echo $data
        exit
        
        title=$(echo "$data" | jq -r '.data.item.title')
        seasonNumber=$(echo "$data" | jq -r '.data.item.seasonNumber // ""')
        episodeNumber=$(echo "$data" | jq -r '.data.item.episodeNumber // ""')

        updatedRow="$URL,$shortId,$title,$seasonNumber,$episodeNumber"
        results+=("$updatedRow")
    fi
done

# Write results to output CSV
echo "URL,ShortId,Title,SeasonNumber,EpisodeNumber" > "$outputFilePath"
printf "%s\n" "${results[@]}" >> "$outputFilePath"

echo "CSV file updated successfully"
