"""
Scopit - Custom Exceptions
"""
from fastapi import HTTPException, status


class AppException(HTTPException):
    """Base application exception"""
    def __init__(
        self,
        status_code: int,
        detail: str,
        error_code: str = None
    ):
        super().__init__(status_code=status_code, detail=detail)
        self.error_code = error_code


class NotFoundException(AppException):
    """Resource not found"""
    def __init__(self, resource: str, id: str = None):
        detail = f"{resource} not found"
        if id:
            detail = f"{resource} with id '{id}' not found"
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail,
            error_code="NOT_FOUND"
        )


class UnauthorizedException(AppException):
    """Authentication failed"""
    def __init__(self, detail: str = "Unauthorized"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            error_code="UNAUTHORIZED"
        )


class ForbiddenException(AppException):
    """Access denied"""
    def __init__(self, detail: str = "Access denied"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
            error_code="FORBIDDEN"
        )


class BadRequestException(AppException):
    """Bad request"""
    def __init__(self, detail: str):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
            error_code="BAD_REQUEST"
        )


class ConflictException(AppException):
    """Conflict (duplicate, etc.)"""
    def __init__(self, detail: str):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
            error_code="CONFLICT"
        )


class FeatureNotAllowedException(AppException):
    """Feature not allowed in current plan"""
    def __init__(self, feature: str):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Upgrade to Pro to use {feature}",
            error_code="FEATURE_NOT_ALLOWED"
        )


class UsageLimitExceededException(AppException):
    """Usage limit exceeded"""
    def __init__(self, resource: str, limit: int):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Monthly {resource} limit ({limit}) exceeded. Upgrade to Pro for unlimited access.",
            error_code="USAGE_LIMIT_EXCEEDED"
        )
