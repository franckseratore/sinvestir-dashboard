"""
Tests du validateur JWT Cloudflare Access.

On simule l'environnement CF Access en :
  - générant une paire RSA locale
  - signant un JWT avec la clé privée
  - mockant le PyJWKClient pour qu'il retourne notre clé publique au lieu de
    fetcher https://{team}.cloudflareaccess.com/cdn-cgi/access/certs
"""
import sys
import time
from pathlib import Path
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.app.cf_access import CFAccessError, validate_cf_jwt

TEAM = "sinvestir.cloudflareaccess.com"
AUD = "fake-aud-tag-for-tests"
ISS = f"https://{TEAM}"


@pytest.fixture
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def _sign(private_key, claims, kid="test-kid"):
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": kid})


def _mock_jwks(public_key, monkeypatch):
    """Patch PyJWKClient.get_signing_key_from_jwt to return our public key."""
    class _FakeKey:
        key = public_key

    from backend.app import cf_access
    monkeypatch.setattr(
        cf_access.PyJWKClient,
        "get_signing_key_from_jwt",
        lambda self, token: _FakeKey(),
    )
    # Reset module-level cache so the fake client is rebuilt
    cf_access._jwks_client = None
    cf_access._jwks_team_domain = None


def test_valid_jwt_returns_claims(rsa_keypair, monkeypatch):
    priv, pub = rsa_keypair
    _mock_jwks(pub, monkeypatch)
    now = int(time.time())
    token = _sign(priv, {"iss": ISS, "aud": AUD, "exp": now + 600, "iat": now, "email": "franck@sinvestir.fr"})
    claims = validate_cf_jwt(token, team_domain=TEAM, audience=AUD)
    assert claims["email"] == "franck@sinvestir.fr"
    assert claims["aud"] == AUD


def test_expired_jwt_rejected(rsa_keypair, monkeypatch):
    priv, pub = rsa_keypair
    _mock_jwks(pub, monkeypatch)
    now = int(time.time())
    token = _sign(priv, {"iss": ISS, "aud": AUD, "exp": now - 60, "iat": now - 3600, "email": "a@b.c"})
    with pytest.raises(CFAccessError):
        validate_cf_jwt(token, team_domain=TEAM, audience=AUD)


def test_wrong_audience_rejected(rsa_keypair, monkeypatch):
    priv, pub = rsa_keypair
    _mock_jwks(pub, monkeypatch)
    now = int(time.time())
    token = _sign(priv, {"iss": ISS, "aud": "other-aud", "exp": now + 600, "iat": now, "email": "a@b.c"})
    with pytest.raises(CFAccessError):
        validate_cf_jwt(token, team_domain=TEAM, audience=AUD)


def test_wrong_issuer_rejected(rsa_keypair, monkeypatch):
    priv, pub = rsa_keypair
    _mock_jwks(pub, monkeypatch)
    now = int(time.time())
    token = _sign(priv, {"iss": "https://evil.example.com", "aud": AUD, "exp": now + 600, "iat": now, "email": "a@b.c"})
    with pytest.raises(CFAccessError):
        validate_cf_jwt(token, team_domain=TEAM, audience=AUD)


def test_empty_token_rejected():
    with pytest.raises(CFAccessError):
        validate_cf_jwt("", team_domain=TEAM, audience=AUD)


def test_missing_config_rejected():
    with pytest.raises(CFAccessError):
        validate_cf_jwt("any.token.value", team_domain="", audience="")
