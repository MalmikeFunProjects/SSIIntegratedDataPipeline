import os
from dotenv import load_dotenv

# Load environment variables from a .env file
# This loads all the environment variables from a .env file into the current Python environment
load_dotenv()

# Retrieve specific environment variables using os.getenv
# These variables contain essential configuration settings for the application

# Retrieve environment variables for the schema registry URL and Kafka bootstrap servers
SCHEMA_REGISTRY_URL = os.getenv("SCHEMA_REGISTRY_URL")
BOOTSTRAP_SERVERS = os.getenv("BOOTSTRAP_SERVERS")

# Kafka topic names for different use cases
KAFKA_TOPIC_HEALTH_SENSOR = os.getenv("KAFKA_TOPIC_HEALTH_SENSOR")
KAFKA_TOPIC_FINNHUB_TRADE = os.getenv("KAFKA_TOPIC_FINNHUB_TRADE")
IOT_SYNTHETIC_URLS = os.getenv("IOT_SYNTHETIC_URLS")
VERAMO_API_TOKEN = os.getenv("VERAMO_API_TOKEN")
VERAMO_API_URL = os.getenv("VERAMO_API_URL")
DID_PROVIDER = os.getenv("DID_PROVIDER", "did:key")

def getBoolean(key:str, default: bool):
    val = os.getenv(key, "").lower()
    truthy = {"1", "t", "true", "yes", "y"}
    falsy = {"0", "f", "false", "no", "n"}
    if val in truthy:
        return True
    if val in falsy:
        return False
    return default

SSI_VALIDATION = getBoolean("SSI_VALIDATION", True)
CACHE_DID = getBoolean("CACHE_DID", False)
PROCESSING_MODE = "async" if os.getenv("PROCESSING_MODE", "sync").lower() == "async" and SSI_VALIDATION else "sync"
