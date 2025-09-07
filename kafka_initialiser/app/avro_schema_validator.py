
from typing import Dict, List, Any
import logging

from app.constants import AVRO_COMPLEX_TYPES, AVRO_PRIMITIVES, AvroType, SchemaValidationError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AvroSchemaValidator:
    """Validates Avro schemas for correctness and consistency"""

    def __init__(self):
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def validate_schema(self, schema: Dict[str, Any], file_path: str = "") -> bool:
        """
        Comprehensive schema validation
        Returns True if valid, False otherwise
        """
        self.errors.clear()
        self.warnings.clear()

        try:
            self._validate_schema_structure(schema, file_path)
            self._validate_schema_semantics(schema)

            if self.errors:
                error_msg = f"Schema validation failed for {file_path}:\n" + "\n".join(self.errors)
                if self.warnings:
                    error_msg += "\nWarnings:\n" + "\n".join(self.warnings)
                raise SchemaValidationError(error_msg)

            if self.warnings:
                logger.warning(f"Schema warnings for {file_path}:\n" + "\n".join(self.warnings))

            return True

        except Exception as e:
            if isinstance(e, SchemaValidationError):
                raise
            self.errors.append(f"Unexpected validation error: {str(e)}")
            raise SchemaValidationError(f"Schema validation failed for {file_path}: {str(e)}")

    def _validate_schema_structure(self, schema: Dict[str, Any], file_path: str):
        """Validate basic schema structure"""
        if not isinstance(schema, dict):
            self.errors.append("Schema must be a JSON object")
            return

        # Required fields
        if "type" not in schema:
            self.errors.append("Schema missing required 'type' field")

        if "name" not in schema:
            self.errors.append("Schema missing required 'name' field")

        # Validate name format
        name = schema.get("name", "")
        if name and not self._is_valid_name(name):
            self.errors.append(f"Invalid schema name '{name}': must be valid identifier")

        # Validate namespace if present
        namespace = schema.get("namespace")
        if namespace and not self._is_valid_namespace(namespace):
            self.errors.append(f"Invalid namespace '{namespace}': must be dot-separated identifiers")

    def _validate_schema_semantics(self, schema: Dict[str, Any]):
        """Validate schema semantics and field definitions"""
        schema_type = schema.get("type")

        if schema_type == AvroType.RECORD.value:
            self._validate_record_schema(schema)
        elif schema_type == AvroType.ENUM.value:
            self._validate_enum_schema(schema)
        elif schema_type == AvroType.FIXED.value:
            self._validate_fixed_schema(schema)

    def _validate_record_schema(self, schema: Dict[str, Any]):
        """Validate record-specific fields"""
        fields = schema.get("fields", [])
        if not isinstance(fields, list):
            self.errors.append("Record 'fields' must be an array")
            return

        field_names = set()
        for i, field in enumerate(fields):
            if not isinstance(field, dict):
                self.errors.append(f"Field {i} must be an object")
                continue

            # Required field properties
            field_name = field.get("name")
            if not field_name:
                self.errors.append(f"Field {i} missing required 'name'")
                continue

            if field_name in field_names:
                self.errors.append(f"Duplicate field name '{field_name}'")
            field_names.add(field_name)

            if "type" not in field:
                self.errors.append(f"Field '{field_name}' missing required 'type'")
            else:
                self._validate_field_type(field["type"], f"field '{field_name}'")

    def _validate_enum_schema(self, schema: Dict[str, Any]):
        """Validate enum-specific fields"""
        symbols = schema.get("symbols", [])
        if not isinstance(symbols, list):
            self.errors.append("Enum 'symbols' must be an array")
            return

        if not symbols:
            self.errors.append("Enum must have at least one symbol")
            return

        symbol_set = set()
        for symbol in symbols:
            if not isinstance(symbol, str):
                self.errors.append(f"Enum symbol '{symbol}' must be a string")
                continue

            if symbol in symbol_set:
                self.errors.append(f"Duplicate enum symbol '{symbol}'")
            symbol_set.add(symbol)

            if not self._is_valid_name(symbol):
                self.errors.append(f"Invalid enum symbol '{symbol}': must be valid identifier")

    def _validate_fixed_schema(self, schema: Dict[str, Any]):
        """Validate fixed-specific fields"""
        size = schema.get("size")
        if size is None:
            self.errors.append("Fixed schema missing required 'size' field")
        elif not isinstance(size, int) or size < 0:
            self.errors.append("Fixed 'size' must be a non-negative integer")

    def _validate_field_type(self, field_type: Any, context: str):
        """Validate field type definitions recursively"""
        if isinstance(field_type, str):
            # Primitive or named type
            if field_type not in AVRO_PRIMITIVES and not self._is_valid_name(field_type):
                self.warnings.append(f"Potentially invalid type reference '{field_type}' in {context}")

        elif isinstance(field_type, list):
            # Union type
            if len(field_type) < 2:
                self.errors.append(f"Union in {context} must have at least 2 types")
            for union_type in field_type:
                self._validate_field_type(union_type, f"{context} union")

        elif isinstance(field_type, dict):
            # Complex type
            type_name = field_type.get("type")
            if type_name == AvroType.ARRAY.value:
                items = field_type.get("items")
                if items is None:
                    self.errors.append(f"Array in {context} missing 'items' field")
                else:
                    self._validate_field_type(items, f"{context} array items")

            elif type_name == AvroType.MAP.value:
                values = field_type.get("values")
                if values is None:
                    self.errors.append(f"Map in {context} missing 'values' field")
                else:
                    self._validate_field_type(values, f"{context} map values")

            elif type_name in AVRO_COMPLEX_TYPES:
                # Inline complex type - validate recursively
                self._validate_schema_semantics(field_type)

    def _is_valid_name(self, name: str) -> bool:
        """Check if name is a valid Avro identifier"""
        if not name or not name.replace("_", "").replace("-", "").isalnum():
            return False
        return name[0].isalpha() or name[0] == "_"

    def _is_valid_namespace(self, namespace: str) -> bool:
        """Check if namespace is valid (dot-separated identifiers)"""
        if not namespace:
            return False
        parts = namespace.split(".")
        return all(self._is_valid_name(part) for part in parts)

