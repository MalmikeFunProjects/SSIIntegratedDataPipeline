import os
from dotenv import load_dotenv

load_dotenv()

SCHEMA_REGISTRY_URL = os.getenv("SCHEMA_REGISTRY_URL")
BOOTSTRAP_SERVERS = os.getenv("BOOTSTRAP_SERVERS")

KAFKA_TOPIC_HEALTH_SENSOR = os.getenv("KAFKA_TOPIC_HEALTH_SENSOR")
KAFKA_TOPIC_FINNHUB_TRADE = os.getenv("KAFKA_TOPIC_FINNHUB_TRADE")
IOT_SYNTHETIC_URLS = os.getenv("IOT_SYNTHETIC_URLS", "").split(",")

KAFKA_HEALTH_SENSOR_KEY_NAME = os.getenv("KAFKA_HEALTH_SENSOR_KEY_NAME", "HealthSensor")
KAFKA_FINNHUB_TRADE_KEY_NAME = os.getenv("KAFKA_FINNHUB_TRADE_KEY_NAME", "FinnhubTrade")

FINNHUB_TRADE_DATA = os.getenv("FINNHUB_TRADE_DATA") == "True"
IOT_SYNTHETIC_DATA = os.getenv("IOT_SYNTHETIC_DATA") == "True"

FINNHUB_DATA_URLS = os.getenv("FINNHUB_DATA_URLS", "").split(",")
DID_PROVIDER = os.getenv("DID_PROVIDER", "did:key")

def getFloatDefault(name, default):
    val = os.getenv(name, "")
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

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
PROCESSING_MODE = "async " if os.getenv("PROCESSING_MODE", "sync").lower() == "async" and SSI_VALIDATION else "sync"
PRODUCER_TIMEOUT = getFloatDefault("PRODUCER_TIMEOUT", None)
