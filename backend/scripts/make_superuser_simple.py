"""
Make a user superuser by email (using raw SQL)
Usage:
  cd backend
  python scripts/make_superuser_simple.py mjbuildworks@gmail.com
"""
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import text  # noqa: E402

from app.core.database import engine  # noqa: E402


def make_superuser(email: str):
    """Set is_superuser=True for user with given email using raw SQL"""

    try:
        with engine.connect() as conn:
            # Check if user exists
            result = conn.execute(
                text("SELECT id, email, full_name, role, is_superuser FROM users WHERE email = :email"),
                {"email": email}
            )
            user = result.fetchone()

            if not user:
                print(f"❌ User not found: {email}")
                return

            # Update to superuser
            conn.execute(
                text("UPDATE users SET is_superuser = true WHERE email = :email"),
                {"email": email}
            )
            conn.commit()

            print(f"✅ User {email} is now a superuser!")
            print(f"   - ID: {user.id}")
            print(f"   - Name: {user.full_name}")
            print(f"   - Role: {user.role}")
            print(f"   - Was Superuser: {user.is_superuser}")
            print("   - Now Superuser: True")

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/make_superuser_simple.py <email>")
        sys.exit(1)

    email = sys.argv[1]
    make_superuser(email)
