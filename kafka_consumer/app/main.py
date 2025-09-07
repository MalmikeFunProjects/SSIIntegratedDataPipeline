from enum import Enum
import logging
import asyncio

from prometheus_client import start_http_server

import app.utils.settings as Utils

from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

from app.handlers.kafka_event_handler import KafkaEventHandler

healthy = False

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Enum to define the Kafka topics the consumer will interact with
# This helps ensure the consistency of topic names when consuming messages from Kafka
class KafkaTopics(Enum):
    # HEALTH_SENSOR = Utils.KAFKA_TOPIC_HEALTH_SENSOR
    FINNHUB_TRADE = Utils.KAFKA_TOPIC_FINNHUB_TRADE

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200 if healthy else 503)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "healthy"}' if healthy else b'{"status": "starting"}')
        else:
            self.send_response(404)
            self.end_headers()

def run_health_server(port=3338):
    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    server.serve_forever()

def kafka_live():
    global healthy
    healthy = True  # ✅ mark healthy only once subscribed

async def main():
    """Main application entry point"""
    # Start Prometheus metrics server
    logger.info("Starting Prometheus metrics server on port 9001")
    start_http_server(9001)

    # Start background thread
    threading.Thread(target=run_health_server, daemon=True).start()

    # Get topic names from enum
    topic_names = [member.value for member in KafkaTopics]
    logger.info(f"Configured topics: {topic_names}")

    # Initialize and start consumer
    kafka_event_handler = KafkaEventHandler(kafka_live=kafka_live)

    try:
        await kafka_event_handler.handle_response_data(topic_names=topic_names)
    except KeyboardInterrupt:
        logger.info("Application shutdown requested")
    except Exception as e:
        logger.error(f"Application error: {e}")
        raise
    finally:
        logger.info("Application stopped")

if __name__ == "__main__":
    asyncio.run(main())
