import logging
import os
from dotenv import load_dotenv

from app.kafka_schema_manager import KafkaSchemaManager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    """Main execution function"""
    try:
        # Load environment variables from a .env file
        load_dotenv()

        # Retrieve environment variables for Avro schema names used in Kafka topics
        AVRO_SCHEMA_DIR = os.getenv("AVRO_SCHEMA_PATH", "app/resources/avro")
        EVENT_TOPICS = os.getenv("EVENT_TOPICS", "")

        # Retrieve environment variables for the schema registry URL and Kafka bootstrap servers
        SCHEMA_REGISTRY_URL = os.getenv("SCHEMA_REGISTRY_URL")
        BOOTSTRAP_SERVERS = os.getenv("BOOTSTRAP_SERVERS")

        # Kafka configuration settings for partitioning and replication
        KAFKA_PARTITIONS = os.getenv("KAFKA_PARTITIONS")
        KAFKA_REPLICATION_FACTOR = os.getenv("KAFKA_REPLICATION_FACTOR")

        # Initialize manager
        manager = KafkaSchemaManager(AVRO_SCHEMA_DIR, SCHEMA_REGISTRY_URL, BOOTSTRAP_SERVERS)

        # Setup schemas
        schemas = manager.setup_schemas()

        # Create topics for event schemas
        event_topics = EVENT_TOPICS.split(",")  # Add your event topic names here
        topic_results = manager.create_topics(
            topic_names=event_topics,
            partitions=int(KAFKA_PARTITIONS),
            replication_factor=int(KAFKA_REPLICATION_FACTOR)
        )

        # Report results
        logger.info("Setup complete:")
        logger.info(f"  - Registered {len(schemas)} schemas")
        logger.info(f"  - Created {sum(topic_results.values())} topics")

    except Exception as e:
        logger.error(f"Setup failed: {e}")
        raise


if __name__ == "__main__":
    main()

