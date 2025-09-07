from typing import Optional

def get_fully_qualified_name(name: str, namespace: Optional[str]) -> str:
    """Get fully qualified name for schema"""
    if "." in name:
        return name
    return f"{namespace}.{name}" if namespace else name
