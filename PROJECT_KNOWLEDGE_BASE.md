# ERP Project Knowledge Base

Tai lieu nen tang cho toan bo du an ERP (Backend + Frontend).
Muc tieu: giu mot "nguon su that" de bat ky lan lam viec nao cung co the doc lai nhanh, thong nhat huong phat trien, va cap nhat lien tuc khi them tinh nang moi.

## 1) Product Scope
- Du an ERP noi bo cho doanh nghiep.
- Nguoi dung chinh: staff, manager, admin.
- Khai niem nghiep vu cot loi:
  - Request Task (giao viec, xu ly, hoan thanh).
  - Request Approval (quy trinh phe duyet theo workflow nhieu buoc).
  - Communications (hop thu noi bo, thread, recipients/targets).
  - Notifications (thong bao trong he thong).
  - RBAC (role/permission) + Departments.

## 2) Tech Stack
- Backend: Django 6, Django REST Framework, JWT (simplejwt), django-filter, corsheaders.
- Frontend: React 19 + Vite + Ant Design.
- DB dev hien tai: SQLite (`backend/db.sqlite3`).
- Async/realtime da cai dat (chua khai thac day du): Celery, Redis, Channels, Daphne.

## 3) System Architecture
- Frontend SPA goi REST API qua axios (`frontend/src/services/api.js`).
- JWT auth:
  - Login: `/api/auth/login/`
  - Refresh: `/api/auth/refresh/`
  - Access token gan vao Authorization header.
- Backend route goc API trong `backend/config/urls.py` voi prefix `/api/`.
- CORS cho local dev da mo cho localhost:5173/5174 va 127.0.0.1.

## 4) Backend Domain Map

### 4.1 users
- Model `User` ke thua `AbstractUser`.
- Bo sung: `full_name`, `department` (FK), `position`, timestamps.
- API:
  - `POST /api/auth/login/`
  - `POST /api/auth/refresh/`
  - CRUD `/api/users/`
  - `GET /api/users/lookup/`
  - `GET /api/users/check-username/`
  - `GET /api/users/:id/permissions/`
- Luu y:
  - Xoa user la soft-delete (`is_active=False`).

### 4.2 departments
- Model `Department`:
  - `name`, `description`, `parent` (self FK), `manager` (FK User), `members` (M2M User).
- Muc tieu nghiep vu: to chuc theo cay phong ban, co manager.

### 4.3 rbac
- Models:
  - `Permission(code, name)`
  - `Role(name, description)`
  - `RolePermission(role, permission)`
  - `UserRole(user, role)`
- Utils quan trong:
  - `get_user_role_names`
  - `user_has_role`, `user_has_any_role`
  - `get_user_permissions`
- Quy uoc role hien tai: admin, manager, staff.

### 4.4 requestsystem
- Models chinh:
  - `Request`:
    - `type`: TASK | APPROVAL
    - `category`: LEAVE | PURCHASE | DOCUMENT | TASK
    - `target_type`: USER | DEPARTMENT
    - `status`: CREATED, PENDING, ACCEPTED, REJECTED, IN_PROGRESS, DONE, FAILED, RATED, PENDING_APPROVAL, APPROVED
    - `priority`: LOW | MEDIUM | HIGH
    - `workflow`, `current_step`, `form_data`, `deadline`, `notes`...
  - `RequestAssignment`
  - `RequestLog`
  - `RequestAttachment`
  - `Rating`
- Luong TASK tong quat:
  1. Tao request -> CREATED
  2. Assign user/department -> PENDING
  3. Nguoi duoc giao accept -> IN_PROGRESS
  4. mark_done -> DONE (hoac mark_failed -> FAILED)
- Luong APPROVAL tong quat:
  1. Tao request APPROVAL
  2. Chon/auto-map workflow theo category
  3. Khoi tao step 1 -> PENDING_APPROVAL
  4. Qua tung step den khi APPROVED hoac REJECTED

### 4.5 approvals
- Models:
  - `Workflow`
  - `WorkflowStep`
  - `WorkflowInstance`
  - `RequestApproval`
  - `ApprovalTemplate`
- Approver scope:
  - ALL_WITH_ROLE
  - DEPT_OF_REQUESTER
  - SPECIFIC_DEPT
  - SPECIFIC_USER
- Rules quan trong:
  - Co auto-skip step neu requester da co role cua step.
  - Reject 1 approver co the ket thuc toan workflow (terminal reject).
  - Co co che bao ve khi sua structure workflow dang co instance active.

### 4.6 communications
- Models:
  - `Message`
  - `MessageRecipient`
  - `MessageTarget`
  - `MessageAttachment`
  - `CustomGroup`
- Tinh nang:
  - Inbox, send, reply theo thread, mark read, mark important.
  - Target theo USER/DEPARTMENT/GROUP.

### 4.7 notifications
- Model `Notification`:
  - `type`: REQUEST | APPROVAL | MESSAGE
  - `is_read`
- API:
  - Danh sach thong bao theo user
  - mark_read, mark_all_read

## 5) Frontend UI/Route Map
- `/login`: Dang nhap.
- `/dashboard`: Tong quan + quick actions.
- `/request`: Quan ly request task/approval.
  - Danh sach task mac dinh uu tien hien thi request moi tao truoc (sort theo `created_at` giam dan o frontend table).
- `/approval`: Man hinh xu ly phe duyet.
- `/inbox`: Hop thu den.
- `/messages/compose`: Soan tin.
- `/messages/:id`: Chi tiet message/thread.
- `/notifications`: Danh sach thong bao.
- `/admin/users`, `/admin/departments`, `/admin/roles`, `/admin/workflow`, `/admin/template`: khu quan tri.

## 6) Integration Contracts (FE <-> BE)
- FE base API:
  - Uu tien `VITE_API_BASE_URL` trong `frontend/.env.local`.
  - Fallback: `http://localhost:8000/api`.
- Login FE goi:
  - `POST /auth/login/` thong qua axios baseURL.
- Neu token het han:
  - FE tu goi `POST /auth/refresh/`.
- Neu refresh fail:
  - FE logout local va redirect `/login`.

## 7) Security and Authorization Rules
- Mac dinh DRF permission global: IsAuthenticated.
- Endpoint public hien tai: login/refresh.
- Khu admin yeu cau role admin (frontend + backend).
- Request visibility duoc gioi han theo creator/assignee/approver.

## 8) Conventions cho phat trien tiep theo
- Uu tien giu architecture hien tai: domain module ro rang theo app.
- Moi logic nghiep vu quan trong dat o service layer (khong nhet het vao views).
- Moi endpoint moi can:
  1. Serializer ro input/output
  2. Permission ro
  3. Test case happy path + fail path
  4. Duoc bo sung vao tai lieu nay
- Moi state moi tren FE can:
  1. Co thong bao loi ro rang cho user
  2. Co loading state
  3. Co empty state

## 9) Roadmap de xuat (co the dieu chinh)
- P1:
  - Health-check FE-BE hien thi ngay tai login.
  - On-screen diagnostics cho auth/network.
  - Hardening workflow approval edge-cases.
- P2:
  - Realtime notifications/messages (Channels/WebSocket).
  - Celery jobs: nhac deadline, thong bao dinh ky.
- P3:
  - Bao cao, thong ke nang cao dashboard.
  - Export du lieu (Excel/PDF).
- P4:
  - Audit timeline xuyen suot tat ca domain.

## 10) Current Open Tasks (Living Backlog)
Muc nay duoc cap nhat lien tuc sau moi buoi lam viec. Day la nguon uu tien thuc thi hien tai.

### P1 - Dang uu tien cao
| ID | Task | Domain | Status | Owner | Notes |
|---|---|---|---|---|---|
| P1-01 | Them health-check endpoint + hien thi trang thai ket noi o login | Backend + Frontend | TODO | Team | Giai quyet nhanh cac loi "khong ket noi duoc may chu" |
| P1-02 | Chuan hoa thong bao loi auth/network tren toan FE | Frontend | TODO | Team | Dong bo message khi 401/403/timeout |
| P1-03 | Bo sung test cho workflow approval edge-cases | Backend | TODO | Team | Tap trung auto-skip, reject terminal, change steps |

### P2 - Quan trong
| ID | Task | Domain | Status | Owner | Notes |
|---|---|---|---|---|---|
| P2-01 | Kich hoat realtime notification/message (Channels) | Backend + Frontend | TODO | Team | Co san dependency, chua bat luong realtime |
| P2-02 | Celery jobs nhac deadline request | Backend | TODO | Team | Gui notification theo lich |
| P2-03 | UI rating sau khi request DONE | Frontend + Backend | TODO | Team | Model da co, can bo sung luong UI/API |

### P3 - Nang cap
| ID | Task | Domain | Status | Owner | Notes |
|---|---|---|---|---|---|
| P3-01 | Dashboard analytics nang cao | Frontend + Backend | TODO | Team | Bieu do theo phong ban/trang thai |
| P3-02 | Export Excel/PDF | Backend + Frontend | TODO | Team | Bao cao cho admin/manager |

### Recently Completed
| ID | Task | Domain | Status | Owner | Notes |
|---|---|---|---|---|---|
| DONE-2026-03-27-01 | Dua request moi tao len dau danh sach quan ly cong viec | Frontend | DONE | Team | Da doi mac dinh sort o man `/request` sang `created_at` giam dan; user da test OK |

### Quy uoc Status
- TODO: Chua bat dau
- IN_PROGRESS: Dang thuc hien
- BLOCKED: Bi chan boi phu thuoc/ha tang
- DONE: Hoan tat va da cap nhat tai lieu nay

## 11) Session Start Protocol (bat buoc truoc khi code)
Moi phien lam viec moi (ke ca sau khi refresh token/mat context), can tuan thu:
1. Doc lai toan bo file nay tu dau den cuoi.
2. Kiem tra muc "Current Open Tasks" va chon task uu tien cao nhat chua DONE.
3. Doi chieu task voi code hien tai truoc khi sua.
4. Sau khi code xong, cap nhat lai file nay ngay lap tuc.

Muc tieu:
- Khong phai train lai tu dau.
- Khong lam trung hoac di lech huong kien truc.
- Luon nho duoc task tiep theo.

## 12) How To Update This Document
Moi khi xong 1 tinh nang, phai cap nhat toi thieu 4 muc sau:
1. Domain thay doi o Backend Domain Map.
2. Route/UI thay doi o Frontend UI/Route Map.
3. API contract thay doi o Integration Contracts.
4. Them 1 dong vao Change Log.

Them 2 yeu cau bat buoc:
5. Cap nhat trang thai task trong "Current Open Tasks".
6. Neu co huong moi, bo sung vao Roadmap.

Template update nhanh:
- Feature:
- Why:
- Backend changed files:
- Frontend changed files:
- API changes:
- DB schema/migration:
- Risks:
- Manual test checklist:

## 13) Definition of Done cho moi tinh nang
Mot tinh nang chi duoc xem la xong khi:
1. Code chay duoc (backend/frontend) va khong vo luong cu.
2. Da test toi thieu happy path + 1 fail path.
3. Da cap nhat cac muc lien quan trong file nay.
4. Da chuyen task tu TODO/IN_PROGRESS sang DONE hoac ghi ro BLOCKED.

## 14) Change Log
- 2026-03-27:
  - Tao file knowledge base tong quan cho toan bo du an.
  - Chot architecture, schema, flow, route, contract de lam nen tang phat trien tiep.
  - Them "Current Open Tasks" de bien tai lieu thanh backlog song.
  - Them "Session Start Protocol" de dam bao moi phien deu doc lai va tiep tuc dung huong.
  - Them "Definition of Done" de chot tieu chuan cap nhat tai lieu sau moi feature.
  - Cap nhat hanh vi man `/request`: request moi tao duoc dua len dau danh sach theo ngay tao giam dan.

## 15) Non-Goals hien tai
- Chua tinh den microservices.
- Chua mo rong multi-tenant.
- Chua dong bo SSO/LDAP (co the them sau neu can).

---

Ghi chu van hanh:
- Neu can nho lai bo canh du an, doc file nay truoc khi code.
- Khi co mau thuan giua code va tai lieu, code la nguon su that tam thoi; cap nhat tai lieu ngay sau khi xac minh.
