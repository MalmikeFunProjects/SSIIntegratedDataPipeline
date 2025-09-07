from typing import Dict, List
import logging

from confluent_kafka.cimpl import KafkaException
from confluent_kafka.admin import AdminClient, NewTopic

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class KafkaTopicManager:
    """Handles Kafka topic operations"""

    def __init__(self, bootstrap_servers: str):
        self.admin_client = AdminClient({"bootstrap.servers": bootstrap_servers})

    def topic_exists(self, topic_name: str) -> bool:
        """Check if topic exists"""
        try:
            topic_list = self.admin_client.list_topics(timeout=10).topics
            return topic_name in topic_list
        except KafkaException as e:
            logger.error(f"Error checking topic existence: {e}")
            return False

    def create_topics(self, topic_names: List[str], partitions: int = 1,
                     replication_factor: int = 1) -> Dict[str, bool]:
        """
        Create topics that don't exist
        Returns dict mapping topic_name -> success_status
        """
        topics_to_create = [
            name for name in topic_names
            if not self.topic_exists(name)
        ]

        if not topics_to_create:
            logger.info("No new topics to create")
            return {}

        topic_configs = [
            NewTopic(
                topic=name,
                num_partitions=partitions,
                replication_factor=replication_factor
            )
            for name in topics_to_create
        ]

        results = {}
        try:
            futures = self.admin_client.create_topics(topic_configs)
            for topic_name, future in futures.items():
                try:
                    future.result()
                    results[topic_name] = True
                    logger.info(f"Successfully created topic: {topic_name}")
                except KafkaException as e:
                    results[topic_name] = False
                    logger.error(f"Failed to create topic {topic_name}: {e}")
        except Exception as e:
            logger.error(f"Error creating topics: {e}")
            results = {name: False for name in topics_to_create}

        return results
