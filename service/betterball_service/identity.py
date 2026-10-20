"""One Azure credential per process, chosen up front.

Inside Azure (Container Apps sets IDENTITY_ENDPOINT) we use the app's managed identity; on a laptop we
use the Azure CLI login. Skipping DefaultAzureCredential's probing avoids a multi-second managed-identity
timeout on every call locally, and sharing the instance lets tokens be cached.
"""

from __future__ import annotations

import os
from functools import lru_cache


def in_azure() -> bool:
    return bool(os.environ.get("IDENTITY_ENDPOINT") or os.environ.get("MSI_ENDPOINT"))


@lru_cache(maxsize=1)
def sync_credential():
    from azure.identity import AzureCliCredential, ManagedIdentityCredential

    return ManagedIdentityCredential() if in_azure() else AzureCliCredential()


_async_credential = None


def async_credential():
    global _async_credential
    if _async_credential is None:
        from azure.identity.aio import AzureCliCredential, ManagedIdentityCredential

        _async_credential = ManagedIdentityCredential() if in_azure() else AzureCliCredential()
    return _async_credential
