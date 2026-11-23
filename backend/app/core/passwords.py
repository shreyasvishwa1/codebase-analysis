"""Password rules shared by sign-up, password change and password reset.

Following NIST SP 800-63B: a minimum length, a generous maximum (which also stops a
multi-megabyte "password" from being hashed), and a refusal of passwords that are known to
be common or are the account's own email. No composition rules (forced symbols or digits).
"""

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128
MIN_DISTINCT_CHARACTERS = 4

# Among the most used passwords in public breach data (only those of 8+ characters matter).
# Compared without regard to case.
COMMON_PASSWORDS = frozenset(
    {
        "password", "password1", "password12", "password123", "password1234", "passw0rd",
        "p@ssw0rd", "p@ssword", "pa$$word", "12345678", "123456789", "1234567890",
        "0123456789", "87654321", "987654321", "11111111", "00000000", "12341234",
        "11223344", "12121212", "123123123", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx",
        "qwertyui", "qwertyuiop", "qwerty123", "qwerty1234", "asdfghjk", "asdfghjkl",
        "zxcvbnm1", "zaq12wsx", "iloveyou", "iloveyou1", "sunshine", "princess",
        "football", "baseball", "superman", "starwars", "whatever", "trustno1",
        "welcome1", "welcome123", "letmein1", "abc12345", "abcd1234", "abcdefgh",
        "aa123456", "computer", "internet", "michelle", "jennifer", "corvette",
        "mercedes", "danielle", "jordan23", "liverpool", "chelsea1", "arsenal1",
        "admin123", "administrator", "changeme", "changeme1", "default1", "secret123",
        "monkey123", "dragon123", "master123", "shadow12", "lovely123", "flower123",
        "hello123", "freedom1", "batman123", "pokemon1", "minecraft", "samsung1",
        "india123", "qwerty12", "google123", "facebook", "computer1", "michael1",
    }
)

TOO_SHORT = f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
TOO_LONG = f"Password must be at most {MAX_PASSWORD_LENGTH} characters long"
TOO_COMMON = "This password is too common or too simple; choose another"
IS_EMAIL = "The password must not be your email address"


def password_problem(password: str, email: str | None = None) -> str | None:
    """Why ``password`` is not acceptable, or None when it is."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return TOO_SHORT
    if len(password) > MAX_PASSWORD_LENGTH:
        return TOO_LONG
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or len(set(lowered)) < MIN_DISTINCT_CHARACTERS:
        return TOO_COMMON
    if email:
        address = email.lower()
        local = address.partition("@")[0]
        if lowered in (address, local):
            return IS_EMAIL
    return None
