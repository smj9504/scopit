# E-Signature Document & Field Mapping — Functional Specification

## 1. 목적 (Purpose)

이 문서는 "문서 업로드 → 필드 매핑(사용자 정의, 동적) → Client 데이터 자동 매핑 → 전자서명 요청(링크/이메일) → 서명 완료 후 PDF 생성 및 이메일 발송" 기능을 다른 프로젝트/코드베이스에서 새로 구현할 수 있도록 정리한 **기능 명세서**입니다. UI/비주얼 디자인 요소(레이아웃, 색상, 컴포넌트 스타일 등)는 포함하지 않으며, 데이터 모델·상태 전이·비즈니스 규칙 등 기능적인 내용만 다룹니다.

> 참고: 이 기능과 동일한 목적의 시스템이 본 저장소(`mj-react-app`)의 `backend/app/domains/contract/`에 이미 구현되어 있습니다. 본 문서는 그 구현을 일반화하여, 특정 기술 스택에 종속되지 않는 형태로 재정리한 것입니다. 실제 코드 참고 매핑은 [9. Reference Implementation Note](#9-reference-implementation-note)를 참고하세요.

## 2. 기능 개요 (Feature Overview)

1. **Document Template 업로드** — 원본 PDF 양식을 업로드하여 재사용 가능한 템플릿을 생성한다.
2. **Field 정의/매핑 (동적)** — 업로드된 문서 위에 임의 개수의 Field를 정의한다. Field는 사용자가 자유롭게 추가/수정/삭제할 수 있으며, 각 Field는 "자동 매핑"(Client 등 기존 데이터에서 값을 가져옴) 또는 "직접 입력"(서명자/발송자가 입력) 방식을 가진다.
3. **자동 필드 매핑 (Prefill)** — 발송 대상(Client 등)을 지정하면, 자동 매핑으로 설정된 Field들이 해당 대상의 실제 데이터로 자동 채워진다.
4. **서명 요청 발송** — 완성된 문서를 다음 두 가지 방식 중 하나로 발송한다:
   - **Direct Link**: 담당자가 대면 상황에서 바로 서명받을 수 있는 서명 URL 발급
   - **Email Request**: 서명자 이메일로 서명 요청 링크 발송
5. **서명 처리** — 서명자가 로그인 없이 링크(토큰)로 접근 → 자신에게 할당된 필드 확인/입력 → 서명 → 서명 동의 확인 → 제출
6. **완료 처리** — 모든 서명이 완료되면 서명 내용이 반영된 최종 PDF를 생성하고, 담당자와 서명자 전원에게 이메일로 발송한다.

## 3. 용어 정의 (Terminology)

| 용어 | 설명 |
|---|---|
| Document Template | 업로드된 원본 PDF + 그 위에 정의된 Field 목록 |
| Field Definition | 문서 내 하나의 입력 요소 정의 (위치, 타입, 매핑 방식, 서명자 역할 등) |
| Document Instance (Envelope) | 특정 대상(Client 등)에게 실제로 발송된 문서 1건의 실행 인스턴스 |
| Recipient / Signer | 서명해야 하는 사람 (역할 기반) |
| Data Source Entity | 자동 매핑의 근거가 되는 기존 데이터 (Client, Company 등 다른 도메인 엔터티) |
| Available Field Registry | 자동 매핑 가능한 소스 필드들의 목록 (확장 가능) |

## 4. 핵심 엔터티 (기능 단위 — 실제 DB 스키마가 아님)

### 4.1 DocumentTemplate
- `id`
- `name`
- `source_file` — 업로드된 원본 PDF에 대한 참조
- `field_definitions[]` — FieldDefinition 목록
- `owner_scope` — 템플릿을 소유하는 조직 단위 (예: company_id). 다른 조직의 템플릿은 조회 불가.
- `status`: `draft | active | archived`
- `created_at` / `updated_at`

### 4.2 FieldDefinition (동적 필드)
- `key` — 템플릿 내 고유 키 (예: `client.name`, `custom.field_1`)
- `label` — 사용자가 정의하는 표시 이름
- `type`: `text | date | signature | initial | checkbox | number | ...` (확장 가능해야 함)
- `page_index`, `x`, `y`, `width`, `height` — 문서 내 위치 (좌표값의 "존재"만 요구사항이며, 시각적 렌더링 방식은 본 스펙 범위 밖)
- `data_binding`:
  - `mode`: `prefilled`(자동 매핑) | `signer_input`(서명자 직접 입력) | `creator_input`(발송자가 발송 전 입력)
  - `source_entity` — `prefilled`인 경우 매핑 대상 엔터티 종류 (예: `Client`, `Claim`, `Company`)
  - `source_field` — `prefilled`인 경우 해당 엔터티의 필드명
- `signer_role` — 이 필드를 입력/서명해야 하는 역할 (예: `homeowner`, `company_rep`)
- `required`: boolean

### 4.3 Available Field Registry
- 시스템은 자동 매핑 가능한 소스 필드 목록을 제공해야 한다.
- Client 엔터티 필드(이름, 이메일, 주소, 전화번호 등)를 기본 포함해야 하며, 향후 다른 엔터티가 추가될 때 매핑 후보도 함께 등록될 수 있도록 **레지스트리 기반으로 확장 가능**해야 한다.
- 소스 엔터티에 매핑되지 않는 "커스텀 필드"도 지원해야 한다 (사용자가 이름/값을 임의로 정의, 예: `custom.field_1..N`).

### 4.4 DocumentInstance (Envelope)
- `id`
- `template_id`
- `target_entity_ref` — 어떤 대상(Client 등)에 대해 발송되었는지
- `recipients[]` — Recipient(role, name, email, phone)
- `prefill_data` — 자동 매핑으로 채워진 값의 스냅샷
- `delivery_method`: `direct_link | email_request`
- `signing_token` / `token_expires_at`
- `status`: `draft | sent | viewed | partially_signed | signed | voided | expired`
- `filled_pdf_ref` — 값이 채워진(서명 전) PDF
- `signed_pdf_ref` — 서명 완료 후 최종 PDF
- `audit_log[]` — 상태 변경 이력 (누가/언제/무엇을, IP 등)
- `created_at` / `sent_at` / `completed_at`

### 4.5 SignatureRecord
- `document_instance_id`
- `signer_role`
- `signature_image` / `signature_type` (`drawn | typed`)
- `ip_address`, `user_agent`, `signed_at`
- `consent_agreed`: boolean — 전자서명 동의 여부 (필수)
- `document_hash` — 서명 시점 문서의 무결성 검증용 해시

## 5. 기능 요구사항 (Functional Requirements)

### FR-1 문서 템플릿 업로드
- FR-1.1 사용자는 PDF 파일을 업로드하여 새 DocumentTemplate을 생성할 수 있다.
- FR-1.2 업로드된 원본 파일은 스토리지에 저장되고 템플릿에 참조로 연결된다.
- FR-1.3 하나의 템플릿은 여러 DocumentInstance(발송 건)에서 재사용될 수 있다.
- FR-1.4 템플릿은 소유 조직 범위로 격리된다.

### FR-2 필드 정의 및 매핑 (동적 필드)
- FR-2.1 사용자는 템플릿에 Field를 자유롭게 추가/수정/삭제할 수 있다 (개수 제한 없음).
- FR-2.2 각 Field는 페이지 번호와 문서 내 위치(좌표)를 가진다.
- FR-2.3 각 Field는 타입을 가진다 (텍스트/날짜/서명/이니셜/체크박스/숫자 등) — 타입 목록은 확장 가능해야 한다.
- FR-2.4 각 Field는 데이터 바인딩 모드(`prefilled` / `signer_input` / `creator_input`)를 가진다.
- FR-2.5 `prefilled` Field는 Available Field Registry에서 소스 필드를 선택하는 방식으로 정의한다.
- FR-2.6 Registry는 Client 필드를 기본 포함하며, 다른 도메인 엔터티도 추가될 수 있도록 확장 가능해야 한다.
- FR-2.7 소스 엔터티 없는 "커스텀 필드"도 지원해야 한다.
- FR-2.8 Field 정의는 템플릿 단위로 저장되며, 새 인스턴스를 만들 때마다 재사용된다.

### FR-3 문서 인스턴스 생성 및 자동 채움 (Prefill)
- FR-3.1 템플릿과 대상 Client(또는 다른 대상 엔터티)를 지정하면, `prefilled` Field들은 대상의 실제 데이터로 자동 채워진다.
- FR-3.2 자동 채움 값은 **발송 시점의 스냅샷**으로 저장한다 (이후 Client 정보가 바뀌어도 이미 발송된 문서는 영향받지 않음).
- FR-3.3 `creator_input` Field는 발송 전 발송자가 값을 입력해야 발송 가능하다 (필수 필드 검증 포함).
- FR-3.4 발송 전 값이 채워진 상태의 문서를 미리 확인할 수 있어야 한다 (내용 검증 목적).

### FR-4 서명 요청 발송
- FR-4.1 다음 두 발송 방식을 지원해야 한다:
  - a) **Direct Link 발급**: 담당자가 대면 상황에서 즉시 접근 가능한 서명 URL 생성
  - b) **Email Request**: 서명자 이메일로 서명 요청 링크 발송
- FR-4.2 발송 시 추측 불가능한 `signing_token`이 생성되며, 만료 시간을 가진다 (설정 가능).
- FR-4.3 다수 서명자가 필요한 경우 recipient별 역할이 구분되고, 서명자는 자신의 role에 해당하는 Field만 입력할 수 있다.
- FR-4.4 발송 후 상태는 `sent`로 전이된다.

### FR-5 서명 페이지 접근 및 처리 (비로그인 공개 접근)
- FR-5.1 서명자는 로그인 없이 링크(토큰)만으로 서명 페이지에 접근할 수 있어야 한다.
- FR-5.2 토큰 만료 또는 이미 서명 완료된 경우, 접근 시 안내와 함께 접근이 차단되어야 한다.
- FR-5.3 서명자는 자신의 role에 매핑된 Field(서명, `signer_input`)만 입력할 수 있고, 다른 서명자의 Field는 읽기 전용이거나 비노출이어야 한다.
- FR-5.4 서명 제출 전 "서명 동의(consent)" 확인이 필수여야 한다.
- FR-5.5 제출 시 IP 주소, 제출 시각, 서명 이미지(또는 타이핑 서명), 문서 해시를 기록해야 한다 (감사 추적/무결성 증빙).
- FR-5.6 페이지 최초 열람 시 상태를 `viewed`로 기록해야 한다.

### FR-6 완료 처리 및 최종 PDF 생성
- FR-6.1 모든 필수 서명자가 서명을 완료하면 상태가 `signed`로 전이된다.
- FR-6.2 원본 템플릿 + 채워진 필드 값 + 서명 이미지를 결합하여 최종 서명 PDF를 생성해야 한다.
- FR-6.3 생성된 최종 PDF는 스토리지에 저장되고 인스턴스에 참조로 연결된다.
- FR-6.4 완료 시 자동으로 이메일을 발송해야 한다:
  - 수신자: 담당자(내부 발송 담당자) + 서명자(외부 서명 완료자) 전원
  - 첨부: 최종 서명된 PDF
- FR-6.5 이메일 발송 실패가 서명 완료 처리 자체를 롤백해서는 안 되며, 실패는 별도로 기록/재시도 가능해야 한다.

### FR-7 상태 관리 및 감사 로그
- FR-7.1 DocumentInstance는 최소한 다음 상태를 가져야 한다: `draft, sent, viewed, partially_signed, signed, voided, expired`.
- FR-7.2 모든 상태 전이는 audit_log에 기록되어야 한다 (누가/언제/무엇을).
- FR-7.3 담당자는 발송된 문서를 임의로 무효화(void)할 수 있어야 한다.

## 6. 데이터 흐름 (Data Flow)

```
Upload Template
   → Define Fields (동적, 사용자 정의, 자동/수동 매핑 지정)
   → Create Instance (대상 Client 지정)
   → Prefill (자동 매핑 필드 채움)
   → Send (direct_link | email_request)
   → Sign (토큰 기반 공개 접근, 서명자 입력 + 서명 + 동의)
   → Complete (모든 서명자 완료)
   → Generate Signed PDF
   → Email Notify (담당자 + 서명자)
```

## 7. 확장성 요구사항 (Extensibility Requirements)

- **EX-1** Field 타입은 코드 수정 없이(또는 최소 수정으로) 추가 가능한 구조여야 한다 (registry 기반).
- **EX-2** 매핑 가능한 Source Entity/Field 목록은 registry 기반으로 관리되어, 새 도메인이 추가될 때 확장 가능해야 한다.
- **EX-3** 이메일 문구(요청 메일/완료 메일)는 커스터마이징 가능해야 한다.
- **EX-4** 발송 방식(현재: link, email)은 향후 SMS 등이 추가될 수 있도록 전략 패턴/확장 가능한 enum으로 설계해야 한다.

## 8. 필수 보안/무결성 요구사항

디자인 영역은 아니지만, 전자서명 기능의 필수 기능 요구사항이므로 포함합니다.

- 서명 토큰은 추측 불가능해야 하며 만료 시간을 가져야 한다.
- 서명된 문서는 사후 변조가 불가능해야 하며(해시 검증), 감사 로그가 보존되어야 한다.
- 서명자 개인정보(이메일/IP 등)는 관련 법규(전자서명법 등)에 따른 보관/파기 정책이 필요하다.

## 9. Reference Implementation Note

이 스펙은 본 저장소 `backend/app/domains/contract/`에 이미 구현된 기능을 일반화한 것입니다. 코드 참고 매핑:

| 스펙 엔터티/개념 | 실제 구현 위치 |
|---|---|
| DocumentTemplate | `contract/models.py :: ContractTemplate` |
| FieldDefinition | `FieldMappingItem` (`fieldKey`, `fieldType`, `x/y/width/height`, `signerRole`, `inputMode`) |
| Available Field Registry | `contract/service.py :: AVAILABLE_FIELDS` |
| DocumentInstance | `contract/models.py :: ContractInstance` (`signing_token`, `status`, `prefill_data`, `filled_pdf_url`, `signed_pdf_url`, `audit_log`) |
| SignatureRecord | `contract/models.py :: ContractSignature` (`signature_image`, `signature_type`, `ip_address`, `consent_agreed`, `document_hash`) |
| 자동 채움 로직 (Prefill) | `contract/service.py :: _build_prefill()`, `_resolve_field_value()` |
| 서명 페이지 (공개 접근) | `contract/signing_api.py`, `contract/field_signing_api.py` |
| PDF 생성 (필드 오버레이) | `common/services/pdf_service.py` (pypdf + reportlab) |
| 이메일 발송 | `claim_followup/smtp_service.py` 패턴 (`water_mitigation/adjuster_email_service.py`가 오케스트레이션 참고 예시) |
| 파일 스토리지 추상화 | `domains/storage/base.py :: StorageProvider` (local / GCS / Google Drive 구현체) |

다른 프로젝트에서 이 기능을 새로 구현할 경우, 위 엔터티/요구사항을 기준으로 자체 기술 스택(DB, 파일 스토리지, 이메일 프로바이더)에 맞게 구현하면 됩니다.

## 10. API Surface (기능 단위 예시 — 실제 엔드포인트명은 구현체마다 다를 수 있음)

**Templates**
- `POST /templates` — 업로드 + 템플릿 생성
- `GET /templates`, `GET /templates/{id}`
- `PUT /templates/{id}/fields` — Field 정의 저장/수정
- `DELETE /templates/{id}`

**Field Registry**
- `GET /fields/available` — 매핑 가능한 소스 필드 목록 조회

**Instances**
- `POST /instances` — 템플릿 + 대상 엔터티 지정하여 생성 (prefill 수행)
- `POST /instances/{id}/send` — link 발급 또는 email 발송 (`delivery_method` 지정)
- `GET /instances/{id}` — 상태/이력 조회
- `POST /instances/{id}/void`

**Public Signing** (인증 없음, `signing_token` 기반)
- `GET /sign/{token}` — 문서 정보 + prefill 값 + Field 정의 반환
- `POST /sign/{token}/submit` — 서명자 role별 입력값 + 서명 이미지 + consent 제출

**Completion**
- 별도 API 불필요 — 서명 완료(submit) 시 내부적으로 PDF 생성 + 이메일 발송이 자동 트리거된다 (FR-6).
