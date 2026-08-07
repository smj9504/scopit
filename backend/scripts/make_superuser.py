"""
Make a user superuser by email
Usage:
  cd backend
  python scripts/make_superuser.py mjbuildworks@gmail.com
"""
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy.orm import Session  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.domains.user.models import User  # noqa: E402


def make_superuser(email: str):
    """Set is_superuser=True for user with given email"""
    db: Session = SessionLocal()

    try:
        # Find user
        user = db.query(User).filter(User.email == email).first()

        if not user:
            print(f"❌ User not found: {email}")
            return

        # Update to superuser
        user.is_superuser = True
        db.commit()

        print(f"✅ User {email} is now a superuser!")
        print(f"   - ID: {user.id}")
        print(f"   - Name: {user.full_name}")
        print(f"   - Role: {user.role}")
        print(f"   - Is Superuser: {user.is_superuser}")

    except Exception as e:
        print(f"❌ Error: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/make_superuser.py <email>")
        sys.exit(1)

    email = sys.argv[1]
    make_superuser(email)
