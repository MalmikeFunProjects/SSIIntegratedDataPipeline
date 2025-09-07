import asyncio
import logging

from prometheus_client import start_http_server

from app.gather_data.process_data import ProcessData
import app.utils.settings as UTILS

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("process_health_sensor_data")

async def main():
    config = {
        'bootstrap.servers': UTILS.BOOTSTRAP_SERVERS,
        'schema_registry.url': UTILS.SCHEMA_REGISTRY_URL,
    }
    if UTILS.FINNHUB_TRADE_DATA:
        if not UTILS.FINNHUB_DATA_URLS:
            raise ValueError("FINNHUB_DATA_URLS must be provided in settings")
        config['schema.name'] = UTILS.KAFKA_TOPIC_FINNHUB_TRADE
        trade_processor = ProcessData(
            urls=UTILS.FINNHUB_DATA_URLS,
            key_name=UTILS.KAFKA_FINNHUB_TRADE_KEY_NAME,
            props=config,
            timeout=UTILS.PRODUCER_TIMEOUT
        )
        await trade_processor.run()

    if UTILS.IOT_SYNTHETIC_DATA:
        if not UTILS.IOT_SYNTHETIC_URLS:
            raise ValueError("IOT_SYNTHETIC_URLS must be provided in settings")
        config['schema.name'] = UTILS.KAFKA_TOPIC_HEALTH_SENSOR
        sensor_processor = ProcessData(
            urls=UTILS.IOT_SYNTHETIC_URLS,
            key_name=UTILS.KAFKA_HEALTH_SENSOR_KEY_NAME,
            props=config,
            timeout=UTILS.PRODUCER_TIMEOUT
        )
        await sensor_processor.run()

if __name__ == "__main__":
    start_http_server(9000)
    asyncio.run(main())
