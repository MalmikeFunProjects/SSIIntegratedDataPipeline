import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger("utilities")


# Utility class that provides helper functions for working with data, files, and schema
class Utilities:
    """
    A utility class containing static methods for various common operations
    such as reading/writing data, handling schemas, and working with DataFrames.
    """

    @staticmethod
    def delivery_report(err, msg) -> None:
        """
        A callback function that logs the result of Kafka message delivery attempts.

        Parameters:
            err (KafkaError or None): Error object if the delivery failed, otherwise None.
            msg (Message): The Kafka message object containing the details of the sent message.

        Logs:
            Prints success or failure of the message delivery to the console.
        """
        if err:
            logger.error(f"Delivery failed for record {msg.key()}: {err}")
            return
        logger.info(f'Record {msg.key()} successfully produced to {msg.topic()} [{msg.partition()}] at offset {msg.offset()}')
