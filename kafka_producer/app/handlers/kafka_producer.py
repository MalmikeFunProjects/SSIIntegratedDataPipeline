from typing import Any
import logging
import time
from confluent_kafka import SerializingProducer
from confluent_kafka.schema_registry import SchemaRegistryClient, SchemaRegistryError
from confluent_kafka.serialization import StringSerializer, SerializationContext, MessageField
from confluent_kafka.schema_registry.avro import AvroSerializer

from app.utils.utilities import Utilities
import app.metrics.metrics as metrics

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger("kafka_producer")


class KafkaProducer:
    def __init__(self, props: dict):
        """
        Initializes the KafkaProducer object.

        This constructor sets up the schema registry client, the Kafka producer,
        and the Avro serializer for the record values. It also ensures that the schema
        is fetched from the schema registry.

        Parameters:
            props (dict): A dictionary containing configuration properties for the producer and schema registry.
                          This includes 'bootstrap.servers', 'schema_registry.url', and 'schema.name'.
        """
        # Configure the schema registry client with the provided URL
        schema_registry_props = {'url': props['schema_registry.url']}
        self.schema_registry_client = SchemaRegistryClient(
            schema_registry_props)

        # Configure the producer with the provided bootstrap server
        producer_props = {'bootstrap.servers': props['bootstrap.servers']}
        self.producer = SerializingProducer(producer_props)

        # Retrieve the subjects (schemas) from the schema registry
        self.schema_registry_client.get_subjects()

        # Serializer for the key (string format)
        self.key_serializer = StringSerializer('utf-8')

        # Retrieve the Avro schema from the registry for the given schema name
        schema_instance = self._get_schema_from_registry(
            props['schema.name'], props.get('schema.subject'))
        # Create an Avro serializer for the value using the retrieved schema

        self.value_serializer = AvroSerializer(
            schema_registry_client=self.schema_registry_client,
            schema_str=schema_instance,
            conf={
                # "auto.register.schemas": False,
                # "use.latest.version": True
                "auto.register.schemas":False,
                "use.latest.version":True,
            }
        )

    def _get_schema_from_registry(self, schema_name: str, subject: str = None):
        """
        Retrieves the Avro schema from the Schema Registry.

        This method fetches the latest version of the schema for a given subject
        from the schema registry and returns it.

        Parameters:
            schema_name (str): The name of the schema to retrieve.
            subject (str, optional): The schema subject name (default is None, which uses the default naming convention).

        Returns:
            str: The Avro schema string retrieved from the registry.

        Raises:
            SchemaRegistryError: If there is an issue with the schema registry.
            Exception: If any unexpected error occurs during schema retrieval.
        """
        try:
            subject =  subject or f"{schema_name}-value"
            schema_version = self.schema_registry_client.get_latest_version(subject)
            return schema_version.schema
        except SchemaRegistryError as e:
            logger.error(f"Error retrieving schema from registry: {e}")
            raise
        except Exception as e:
            logger.error(f"An unexpected error occurred: {e}")
            raise

    def publishToKafka(self, topic: str, key: str, record: dict[Any, Any]):
        """
        Publishes a record to Kafka.

        This method serializes the key and value and sends the record to the specified Kafka topic.
        It also handles any exceptions and invokes a callback for delivery reports.

        Parameters:
            topic (str): The Kafka topic to send the record to.
            key (str): The key used to partition the Kafka messages.
            record (dict): The record (message) to be sent to Kafka, represented as a dictionary.

        Raises:
            Exception: If any exception occurs while producing the record to Kafka.
        """
        start_time = time.time()
        try:
            # Produce the message to Kafka
            self.producer.produce(topic=topic,
                                  key=self.key_serializer(key),
                                  value=self.value_serializer(record, SerializationContext(
                                      topic=topic, field=MessageField.VALUE)),
                                  on_delivery=Utilities.delivery_report  # Callback function for delivery report
                                  )
            self.producer.poll(0)  # Ensure delivery callbacks are triggered

            metrics.labels(metrics.producer_requests_total,
                topic=topic, did=record.get("did", "")).inc()
            metrics.labels(metrics.producer_request_duration_seconds,
                topic=topic, did=record.get("did", "")).observe(time.time() - start_time)
        except KeyboardInterrupt as err:
            metrics.labels(metrics.producer_request_failures,
                topic=topic, did=record.get("did", "")).inc()
            logger.error(f"Producer interrupted: {err}")
            raise err
        except Exception as err:
            metrics.labels(metrics.producer_request_failures,
                topic=topic, did=record.get("did", "")).inc()
            logger.error(f"Error producing message to Kafka: {err}")
            raise err
