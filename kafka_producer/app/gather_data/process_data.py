import json
import logging
from typing import Optional

from app.gather_data.websocket_data_request import WebsocketDataRequest
from app.handlers.kafka_producer import KafkaProducer
import app.metrics.metrics as metrics

logger = logging.getLogger("process_data")

class ProcessData():
    def __init__(self, urls: list[str], key_name: str, props: dict[str, str] = None, timeout: Optional[float] = None):
        config = {
            'bootstrap.servers': props["bootstrap.servers"],
            'schema_registry.url': props["schema_registry.url"],
            'schema.name': props["schema.name"]
        }
        self.producer = KafkaProducer(props=config)
        self.urls = urls
        self.schema_name = props.get("schema.name")
        if not self.schema_name:
            raise ValueError("Schema name must be provided in props")
        self.key_name = key_name
        self.timeout = timeout

    def __normalize_payload(self, rec: dict) -> dict:
        if "tradeCredential" not in rec:
            return rec
        cred = rec.get("tradeCredential")
        if isinstance(cred, dict) and "@context" in cred:
            cred["context"] = cred.pop("@context")
        return rec

    async def __process_message(self, message: str, url: str, message_count: int):
        try:
            data = json.loads(message)
            norm_data = self.__normalize_payload(data)
            metrics.labels(metrics.websocket_messages_received_total,
                url=url, did=norm_data.get("did", "")).inc()
            self.producer.publishToKafka(
                topic=self.schema_name, key=self.key_name, record=norm_data)
            log_message = (
                f"\n{'='*70}\n"
                f"PROCESSED MESSAGE\n"
                f"{'='*70}\n"
                f"Source: [{url}]\n"
                f"Message Count: {message_count}\n"
                f"Message: {norm_data}\n"
                f"{'='*70}"
            )
            logger.info(log_message)


        except json.JSONDecodeError as e:
            logger.error(f"Error decoding JSON: {e}")
        except KeyError as e:
            logger.error(f"Missing expected key: {e}")
        except Exception as e:
            logger.error(f"Unhandled error while processing message: {e}")

    async def run(self):
        sensor = WebsocketDataRequest(producer=self.producer, timeout=self.timeout)
        await sensor.run_multiple(self.urls, message_handler=self.__process_message)

