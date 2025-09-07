import time
from typing import Callable, Dict, Generator, List
import logging

from confluent_kafka import DeserializingConsumer, KafkaError
from confluent_kafka.error import ValueDeserializationError
from confluent_kafka.schema_registry import SchemaRegistryClient
from confluent_kafka.schema_registry.avro import AvroDeserializer
from confluent_kafka.serialization import StringDeserializer

from app.metrics.metrics import Metrics
import app.utils.settings as Utils

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger("KafkaConsumer")


class KafkaConsumer:
    """
    A Kafka consumer that reads Avro-serialized messages from Kafka topics.

    Attributes:
        consumer (DeserializingConsumer): A Kafka consumer configured to deserialize Avro messages.
    """

    def __init__(self, props: Dict):
        """
        Initializes the KafkaConsumer with schema registry and consumer properties.

        Parameters:
            props (Dict): A dictionary containing Kafka and schema registry configurations.
                Expected keys:
                - 'schema_registry.url': URL of the schema registry.
                - 'bootstrap.servers': Kafka broker addresses.
        """
        self.metrics = Metrics()
        self.last_message_time = {}
        schema_registry_props = {'url': props['schema_registry.url']}
        schema_registry_client = SchemaRegistryClient(schema_registry_props)
        avro_deserializer = AvroDeserializer(
            schema_registry_client=schema_registry_client)

        consumer_props = {
            'bootstrap.servers': props['bootstrap.servers'],
            'group.id': 'malmike.kafka_consumer.avro.consumer.2',
            'key.deserializer': StringDeserializer('utf_8'),
            'value.deserializer': avro_deserializer,
            'auto.offset.reset': "latest"
        }

        self.consumer = DeserializingConsumer(consumer_props)
        self.metrics.labels(self.metrics.active_consumers, did_provider=Utils.DID_PROVIDER).inc()

        logger.info("KafkaConsumer initialized with properties: %s", props)

    def consume_from_kafka(self, topics: List[str], on_assign: Callable[..., None]) -> Generator[tuple, None, None]:
        """
        Consumes messages from specified Kafka topics and yields them as a generator.

        Parameters:
            topics (List[str]): A list of Kafka topics to subscribe to.

        Yields:
            tuple: A tuple containing (topic, key, record) where:
                - topic (str): The topic from which the message was consumed.
                - key: The key of the Kafka message (if available).
                - record: The deserialized Avro record from the message value.
        """
        logger.info("=" * 50)
        logger.info("Subscribing to topics: %s", topics)
        self.consumer.subscribe(topics=topics, on_assign=on_assign)

        # Throughput calculation variables
        message_counts = {topic: 0 for topic in topics}
        last_throughput_calculation = time.time()

        try:
            while True:
                try:
                    # SIGINT can't be handled when polling, limit timeout to 1 second.
                    msg = self.consumer.poll(1.0)
                    if msg is None:
                        self._update_consumer_lag(topics)
                        continue
                    if msg.error():
                        if msg.error().code() == KafkaError._PARTITION_EOF:
                            logger.info(
                                'End of partition reached for topic: %s', msg.topic())
                            continue
                        else:
                            logger.error(f"Kafka error: {msg.error()}")
                            self.metrics.labels(self.metrics.processing_errors_total,
                                did_provider=Utils.DID_PROVIDER,
                                topic=msg.topic(),
                                error_type="kafka_error"
                            ).inc()
                            break
                    # Extract message details
                    topic = msg.topic()
                    key = msg.key()
                    record = msg.value()

                    # Update message tracking
                    self.last_message_time[topic] = time.time()
                    message_counts[topic] += 1

                    # Record message size
                    if msg.value():
                        message_size = len(str(msg.value()).encode('utf-8'))
                        self.metrics.labels(self.metrics.message_size_bytes,
                            did_provider=Utils.DID_PROVIDER,
                            topic=topic).observe(message_size)

                    # Update throughput metrics periodically
                    current_time = time.time()
                    if current_time - last_throughput_calculation >= 10:  # Every 10 seconds
                        self._update_throughput_metrics(
                            message_counts, current_time - last_throughput_calculation)
                        message_counts = {topic: 0 for topic in topics}
                        last_throughput_calculation = current_time

                    if record is not None:
                        self.metrics.labels(self.metrics.messages_consumed_total,
                            did_provider=Utils.DID_PROVIDER,
                            topic=topic, status="success").inc()
                        yield (topic, key, record)
                    else:
                        self.metrics.labels(self.metrics.messages_consumed_total,
                            did_provider=Utils.DID_PROVIDER,
                            topic=topic, status="null_record").inc()
                        yield (topic, key, None)

                except KeyboardInterrupt:
                    logger.info(
                        "Received keyboard interrupt, shutting down...")
                    break

                except ValueDeserializationError as e:
                    topic = getattr(e, "kafka_message", None)
                    topic_name = topic.topic() if topic else "unknown"
                    logger.error(
                        "Value deserialization failed on topic=%s: %s", topic_name, e)
                    self.metrics.labels(self.metrics.deserialization_errors_total,
                        did_provider=Utils.DID_PROVIDER,
                        topic=topic_name).inc()
                    continue

                except Exception as e:
                    topic_name = getattr(
                        getattr(e, "kafka_message", None), "topic", lambda: "unknown")()
                    logger.error(f"Kafka polling failed: {e}")
                    self.metrics.labels(self.metrics.processing_errors_total,
                        did_provider=Utils.DID_PROVIDER,
                        topic=topic_name,
                        error_type="polling_error"
                    ).inc()
                    continue
        finally:
            logger.info("Closing Kafka consumer...")
            self.consumer.close()
            self.metrics.labels(self.metrics.active_consumers, did_provider=Utils.DID_PROVIDER).dec()

    def _update_consumer_lag(self, topics: List[str]) -> None:
        """Update consumer lag metrics for all topics"""
        current_time = time.time()
        for topic in topics:
            if topic in self.last_message_time:
                lag = current_time - self.last_message_time[topic]
                self.metrics.labels(self.metrics.consumer_lag,
                    did_provider=Utils.DID_PROVIDER, topic=topic).set(lag)

    def _update_throughput_metrics(self, message_counts: Dict[str, int], time_period: float) -> None:
        """Update throughput metrics"""
        for topic, count in message_counts.items():
            throughput = count / time_period if time_period > 0 else 0
            self.metrics.labels(self.metrics.messages_per_second,
                did_provider=Utils.DID_PROVIDER, topic=topic).set(throughput)
