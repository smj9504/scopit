"""backfill sign_recipients from legacy single-recipient sign_requests rows

Revision ID: a3b4c5d6e7f8
Revises: f7a8b9c0d1e2
Create Date: 2026-08-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session


# revision identifiers, used by Alembic.
revision = 'a3b4c5d6e7f8'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None


STATUS_MAP = {
    "signed": "signed",
    "declined": "declined",
    "viewed": "viewed",
    "sent": "sent",
    "cancelled": "sent",
    "expired": "sent",
}


def upgrade():
    """Create one sign_recipients row per existing sign_requests row, reusing
    the envelope's access_token so already-emailed links keep resolving under
    the new recipient-first token lookup."""
    bind = op.get_bind()
    session = Session(bind=bind)

    try:
        from app.common.utils import generate_uuid

        rows = session.execute(sa.text("""
            SELECT sr.id, sr.status, sr.recipient_name, sr.recipient_email, sr.access_token,
                   sr.viewed_at, sr.signed_at, sr.declined_at, sr.signature_data,
                   sr.signature_type, sr.signature_font, sr.signer_ip, sr.signer_user_agent,
                   sr.created_at, sr.updated_at
            FROM sign_requests sr
            WHERE NOT EXISTS (SELECT 1 FROM sign_recipients r WHERE r.sign_request_id = sr.id)
        """)).fetchall()

        count = 0
        for row in rows:
            session.execute(sa.text("""
                INSERT INTO sign_recipients (
                    id, sign_request_id, role, name, email, phone, sequence,
                    status, access_token, viewed_at, signed_at, declined_at,
                    signature_data, signature_type, signature_font, signer_ip,
                    signer_user_agent, consent_agreed, document_hash,
                    signed_field_values, created_at, updated_at
                ) VALUES (
                    :id, :sign_request_id, 'signer', :name, :email, NULL, 0,
                    :status, :access_token, :viewed_at, :signed_at, :declined_at,
                    :signature_data, :signature_type, :signature_font, :signer_ip,
                    :signer_user_agent, :consent_agreed, NULL,
                    '{}', :created_at, :updated_at
                )
            """), {
                "id": str(generate_uuid()),
                "sign_request_id": str(row.id),
                "name": row.recipient_name or "Recipient",
                "email": row.recipient_email or "",
                "status": STATUS_MAP.get(row.status, "pending"),
                "access_token": row.access_token,
                "viewed_at": row.viewed_at,
                "signed_at": row.signed_at,
                "declined_at": row.declined_at,
                "signature_data": row.signature_data,
                "signature_type": row.signature_type,
                "signature_font": row.signature_font,
                "signer_ip": row.signer_ip,
                "signer_user_agent": row.signer_user_agent,
                "consent_agreed": row.status == "signed",
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            })
            count += 1

        session.commit()
        print(f"Backfilled {count} sign_recipients rows from legacy sign_requests")

    except Exception as e:
        print(f"Warning: could not backfill sign_recipients: {e}")
        # Best-effort: do NOT rollback -- that would revert the entire
        # Alembic transaction including the alembic_version update.


def downgrade():
    """Remove backfilled sign_recipients rows (best-effort: this also removes
    any genuinely new recipients created after this migration ran, since
    there's no reliable marker distinguishing backfilled from new rows)."""
    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        session.execute(sa.text("DELETE FROM sign_recipients"))
        session.commit()
    except Exception:
        session.rollback()
