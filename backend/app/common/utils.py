"""
Scopit - Utility Functions
"""
import random
import uuid
from datetime import date


def generate_uuid() -> uuid.UUID:
    """Generate a new UUID"""
    return uuid.uuid4()


def generate_random_username() -> str:
    """
    Generate a Reddit-style random username.
    Format: AdjectiveNoun + 4 random digits
    Examples: CuriousPanda4521, BrightEagle7832, SwiftDolphin1094
    """
    adjectives = [
        "Happy", "Brave", "Clever", "Swift", "Bright", "Calm", "Bold", "Wise",
        "Lucky", "Noble", "Quick", "Sharp", "Curious", "Gentle", "Fierce",
        "Mighty", "Cosmic", "Stellar", "Golden", "Silver", "Crystal", "Royal",
        "Mystic", "Ancient", "Digital", "Pixel", "Neon", "Electric", "Quantum",
        "Sonic", "Turbo", "Mega", "Super", "Ultra", "Prime", "Alpha", "Omega",
        "Epic", "Legendary", "Radiant", "Vibrant", "Dynamic", "Agile", "Nimble",
        "Keen", "Astute", "Witty", "Daring", "Valiant", "Resolute", "Steadfast"
    ]

    nouns = [
        "Panda", "Eagle", "Tiger", "Wolf", "Bear", "Fox", "Hawk", "Falcon",
        "Lion", "Dolphin", "Phoenix", "Dragon", "Raven", "Owl", "Shark",
        "Panther", "Leopard", "Cheetah", "Cobra", "Viper", "Griffin", "Pegasus",
        "Unicorn", "Kraken", "Hydra", "Sphinx", "Titan", "Knight", "Wizard",
        "Ninja", "Samurai", "Viking", "Pirate", "Ranger", "Hunter", "Scout",
        "Builder", "Maker", "Coder", "Hacker", "Gamer", "Pilot", "Captain",
        "Chief", "Master", "Sage", "Oracle", "Prophet", "Guardian", "Sentinel"
    ]

    adjective = random.choice(adjectives)
    noun = random.choice(nouns)
    number = random.randint(1000, 9999)

    return f"{adjective}{noun}{number}"


def format_currency(amount: float) -> str:
    """Format amount as currency string"""
    return f"${amount:,.2f}"


def get_current_month_range() -> tuple[date, date]:
    """Get start and end dates of current month"""
    today = date.today()
    start = today.replace(day=1)
    
    # Get last day of month
    if today.month == 12:
        end = today.replace(year=today.year + 1, month=1, day=1)
    else:
        end = today.replace(month=today.month + 1, day=1)
    
    from datetime import timedelta
    end = end - timedelta(days=1)
    
    return start, end


def generate_document_number(prefix: str, number: int) -> str:
    """Generate document number like EST-1001, INV-1001"""
    return f"{prefix}-{number}"
