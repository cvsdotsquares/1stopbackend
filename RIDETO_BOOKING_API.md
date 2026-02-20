# RideTo Booking Integration APIs

This document describes the two booking APIs integrated for RideTo external booking system.

## 🔐 Authentication

Both endpoints use **Basic Authentication** with a fixed token.

**Token:** `4lCBbMxPvSBXOYWSej8WAEdl3ZRE0v8O4Y6WMTXLSc100H1xjt`

**Header Format:**
```
Authorization: Basic <base64_encoded_token>
```

**Example (base64 encoded):**
```
Authorization: Basic NGxDQmJNeFB2U0JYT1lXU2VqOFdBRWRsM1pSRTB2OE80WTZXTVRYTFNjMTAwSDF4anQ=
```

---

## 📍 API Endpoints

### Base URL
```
http://localhost:3000/api/booking
```

---

## 1️⃣ Check Availability API

Check if a course is available for booking at a specific date, time, and location.

### Endpoint
```
POST /api/booking/check-availability
```

### Request Headers
```
Content-Type: application/json
Authorization: Basic <token>
```

### Request Body
```json
{
  "school_course_id": 123,
  "location": "London",
  "course_type": "LICENCE_CBT",
  "date": "2024-12-25",
  "start_time": "09:00",
  "finish_time": "17:00",
  "bike_hire_type": "manual"
}
```

### Field Validation

| Field | Type | Required | Format | Description |
|-------|------|----------|--------|-------------|
| `school_course_id` | integer | ✅ | - | Course ID from school system |
| `location` | string | ✅ | - | Location name (e.g., "London") |
| `course_type` | string | ✅ | - | Type of course (e.g., "LICENCE_CBT") |
| `date` | string | ✅ | YYYY-MM-DD | Course date |
| `start_time` | string | ✅ | HH:mm | Start time (24-hour format) |
| `finish_time` | string | ✅ | HH:mm | Finish time (24-hour format) |
| `bike_hire_type` | string | ✅ | - | Bike hire type |

### Response Examples

#### ✅ Success - Available (200)
```json
{
  "message": "Course is available",
  "is_available": true,
  "availableSpace": 5,
  "school_course_id": 123
}
```

#### ❌ No Space Available (400)
```json
{
  "message": "Course is not available",
  "is_available": false,
  "school_course_id": 123
}
```

#### ❌ Course Not Found (404)
```json
{
  "message": "Course is not available"
}
```

#### ❌ Validation Error (400)
```json
{
  "school_course_id": ["School course id is required field"],
  "date": ["Date has wrong format. Use one of these formats instead: YYYY-MM-DD."],
  "start_time": ["Time has wrong format. Use one of these formats instead: hh:mm."]
}
```

#### ❌ Unauthorized (401)
```json
{
  "message": "Authorization header missing or invalid"
}
```

### Database Query
Queries the `booking_status` table with conditions:
- `courseId = school_course_id`
- `address4 = location`
- `event_date = date`
- `event_start_time = start_time`
- `event_end_time = finish_time`
- `course_name = 'CBT'` (if course_type === 'LICENCE_CBT')

### Logging
All requests are logged to `check_availability.log`:
```
[25-12-2024 14:30] :: Status:200 -- Course available >> {"message":"Course is available","is_available":true,"availableSpace":5,"school_course_id":123}
```

---

## 2️⃣ Confirm Booking API

Confirm and create a booking after checking availability and locking space.

### Endpoint
```
POST /api/booking/confirm-booking
```

### Request Headers
```
Content-Type: application/json
Authorization: Basic <token>
```

### Request Body
```json
{
  "school_course_id": 123,
  "location": "London",
  "course_type": "LICENCE_CBT",
  "date": "2024-12-25",
  "start_time": "09:00",
  "finish_time": "17:00",
  "bike_hire": "manual",
  "course_event_id": 456,
  "space_hold_id": 789,
  "rideto_order_number": "RT123456",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "07700900123",
  "email": "john.doe@example.com",
  "driving_licence": "SMITH123456AB7CD"
}
```

### Field Validation

| Field | Type | Required | Format | Description |
|-------|------|----------|--------|-------------|
| `school_course_id` | integer | ✅ | - | Course ID from school system |
| `location` | string | ✅ | - | Location name |
| `course_type` | string | ✅ | - | Type of course |
| `date` | string | ✅ | YYYY-MM-DD | Course date |
| `start_time` | string | ✅ | HH:mm | Start time (24-hour) |
| `finish_time` | string | ✅ | HH:mm | Finish time (24-hour) |
| `bike_hire` | string | ✅ | - | Bike hire type |
| `course_event_id` | integer | ✅ | - | Event ID from booking system |
| `space_hold_id` | integer | ✅ | - | Lock ID from space hold |
| `rideto_order_number` | string | ✅ | - | RideTo order reference |
| `first_name` | string | ✅ | - | Customer first name |
| `phone` | string | ✅ | - | Contact phone number |
| `last_name` | string | ❌ | - | Customer last name |
| `email` | string | ❌ | email | Customer email address |
| `driving_licence` | string | ❌ | - | UK driving licence number |

### Response Examples

#### ✅ Success - Booking Confirmed (200)
```json
{
  "message": "Course is confirmed",
  "school_course_id": 123,
  "booking_ref": "1SRC12345"
}
```

#### ✅ Already Confirmed (200)
```json
{
  "message": "Course is confirmed",
  "school_course_id": 123
}
```

#### ❌ Space Not Locked (400)
```json
{
  "message": "Course is not locked",
  "school_course_id": 123
}
```

#### ❌ Booking Failed (400)
```json
{
  "message": "Course is not available",
  "school_course_id": 123
}
```

#### ❌ Validation Error (400)
```json
{
  "first_name": ["This field may not be blank."],
  "phone": ["This field may not be blank."],
  "course_event_id": ["This field may not be blank."],
  "space_hold_id": ["This field may not be blank."],
  "rideto_order_number": ["This field may not be blank."]
}
```

### Business Logic Flow

1. **Validate Space Lock**
   - Check if `space_hold_id` exists in `lock_bookings` for `course_event_id`
   - Return 400 if not locked

2. **Check Duplicate Order**
   - Query `booking_attendees` and `booking_attendees_dropdown` for `rideto_order_number`
   - If found: Remove lock and return 200 (already confirmed)

3. **Fetch Booking Status**
   - Get course details from `booking_status` table

4. **Create Booking**
   - Insert into `bookings` table with:
     - `booking_made_by = 'admin'`
     - `type_of_book = 'r'` (RideTo)
     - `status = 0` (pending)
     - `spaces = 1`
     - `payment_due = course_cost`

5. **Save Attendee**
   - Generate `booking_ref = '1SRC' + bookingId`
   - Format name: `FirstName LastName (rt#OrderNumber)`
   - Clean phone: Remove spaces
   - Uppercase licence number

6. **Check/Insert Contact Card**
   - Check `booking_attendees_dropdown` by `license_number`
   - Insert or update contact card
   - Get `contact_card_id`

7. **Insert Booking Attendee**
   - Insert into `booking_attendees` with `contact_card_id`
   - Set `primary = 1`

8. **Check/Insert User**
   - If email provided: Check/insert into `users` table
   - Update booking with `user_id`

9. **Complete Booking**
   - Update booking: `status = 1` (confirmed)
   - Insert payment record: `payment_type = 'CASH'`

10. **Update Course Events**
    - Increment `bookings_done` for course event parent

11. **Remove Lock**
    - Delete from `lock_bookings`
    - Decrement `current_locks` in `course_events`

12. **Send Email**
    - Send confirmation email to `bookings@1stopinstruction.com`
    - Uses Postmark SMTP

### Database Tables Involved

| Table | Operation | Purpose |
|-------|-----------|---------|
| `lock_bookings` | SELECT, DELETE | Validate and remove space lock |
| `booking_attendees` | SELECT, INSERT | Check duplicates, save attendee |
| `booking_attendees_dropdown` | SELECT, INSERT, UPDATE | Contact card management |
| `booking_status` | SELECT | Get course details |
| `bookings` | INSERT, UPDATE | Create and update booking |
| `booking_payments` | INSERT | Record payment |
| `course_events` | SELECT, UPDATE | Update bookings_done and locks |
| `users` | SELECT, INSERT | User management |

### Logging

Multiple log files are created:

1. **confirm_booking.log** - All operations
```
[25-12-2024 14:30] :: Status:200 -- Course is confirmed >> {"school_course_id":123,"booking_ref":"1SRC12345"}
```

2. **confirm_already_confirm.log** - Duplicate orders
```
[25-12-2024 14:30] :: Status:200 -- Course is already confirmed >> {"school_course_id":123}
```

3. **aftersaveattendee.txt** - After attendee save
```
[25-12-2024 14:30] :: Status:200 -- Attendee saved >> {"booking_ref":"1SRC12345","bookingId":12345}
```

4. **addBookingsdone.txt** - After bookings_done update
```
[25-12-2024 14:30] :: Status:200 -- Bookings done incremented >> {"parent":456}
```

### Email Notification

Confirmation email sent via **Postmark SMTP**:
- **Host:** smtp.postmarkapp.com
- **Port:** 587 (TLS)
- **From:** info@1stopinstruction.com
- **To:** bookings@1stopinstruction.com
- **Subject:** `[Course Name] Booking Confirmation - [Booking Ref]`

---

## 🔄 Typical Booking Flow

```
1. Frontend calls check-availability
   ↓
2. If available, lock space (separate API)
   ↓
3. Frontend calls confirm-booking with space_hold_id
   ↓
4. Backend validates lock
   ↓
5. Backend creates booking
   ↓
6. Backend removes lock
   ↓
7. Backend sends confirmation email
   ↓
8. Return booking_ref to frontend
```

---

## 🧪 Testing Examples

### cURL - Check Availability
```bash
curl -X POST http://localhost:3000/api/booking/check-availability \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic NGxDQmJNeFB2U0JYT1lXU2VqOFdBRWRsM1pSRTB2OE80WTZXTVRYTFNjMTAwSDF4anQ=" \
  -d '{
    "school_course_id": 123,
    "location": "London",
    "course_type": "LICENCE_CBT",
    "date": "2024-12-25",
    "start_time": "09:00",
    "finish_time": "17:00",
    "bike_hire_type": "manual"
  }'
```

### cURL - Confirm Booking
```bash
curl -X POST http://localhost:3000/api/booking/confirm-booking \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic NGxDQmJNeFB2U0JYT1lXU2VqOFdBRWRsM1pSRTB2OE80WTZXTVRYTFNjMTAwSDF4anQ=" \
  -d '{
    "school_course_id": 123,
    "location": "London",
    "course_type": "LICENCE_CBT",
    "date": "2024-12-25",
    "start_time": "09:00",
    "finish_time": "17:00",
    "bike_hire": "manual",
    "course_event_id": 456,
    "space_hold_id": 789,
    "rideto_order_number": "RT123456",
    "first_name": "John",
    "last_name": "Doe",
    "phone": "07700900123",
    "email": "john.doe@example.com",
    "driving_licence": "SMITH123456AB7CD"
  }'
```

### Postman Collection
Import these endpoints into Postman:
1. Set base URL: `http://localhost:3000`
2. Add Authorization header with Basic Auth token
3. Set Content-Type to `application/json`

---

## 🐛 Error Handling

### Common Errors

| Status | Error | Cause | Solution |
|--------|-------|-------|----------|
| 401 | Authorization header missing | No auth header | Add Authorization header |
| 401 | Invalid authorization token | Wrong token | Use correct token |
| 400 | Validation failed | Missing/invalid fields | Check field formats |
| 400 | Course is not locked | Space not locked | Lock space first |
| 404 | Course is not available | Course not found | Check course_event_id |
| 405 | Method not allowed | Wrong HTTP method | Use POST method |
| 500 | Internal server error | Database error | Check logs |

---

## 📝 Notes

1. **Idempotency**: Confirm booking checks for duplicate `rideto_order_number` to prevent double bookings
2. **Transaction Safety**: All database operations use transactions with rollback on error
3. **Lock Management**: Locks are automatically removed after booking confirmation or on duplicate detection
4. **Phone Formatting**: Phone numbers are cleaned (spaces removed) before storage
5. **Licence Formatting**: Driving licence numbers are trimmed and converted to uppercase
6. **Name Formatting**: Attendee surname includes RideTo order number: `LastName (rt#OrderNumber)`
7. **Booking Reference**: Generated as `1SRC` + booking ID (e.g., `1SRC12345`)

---

## 🔧 Configuration

### Environment Variables
```env
# Database
DB_HOST=172.236.21.167
DB_PORT=3306
DB_USER=1stop
DB_PASSWORD=Gbgz&En4Wg&HmFJTFf
DB_NAME=1stop

# Server
PORT=3000
NODE_ENV=production
```

### Basic Auth Token
Stored in: `src/middleware/basicAuth.js`
```javascript
const VALID_TOKEN = '4lCBbMxPvSBXOYWSej8WAEdl3ZRE0v8O4Y6WMTXLSc100H1xjt';
```

---

## 📊 Database Schema Reference

### booking_status (View)
- `courseId` - Course ID
- `eventId` - Event ID
- `course_name` - Course name
- `course_cost` - Course price
- `address4` - Location
- `event_date` - Event date
- `event_start_time` - Start time
- `event_end_time` - End time
- `availableSpace` - Available spaces

### bookings
- `id` - Primary key
- `course_id` - FK to courses
- `course_event_id` - FK to course_events
- `user_id` - FK to users
- `booking_made_by_id` - Admin ID (5)
- `booking_made_by` - 'admin'
- `type_of_book` - 'r' (RideTo)
- `spaces` - Number of spaces (1)
- `payment_due` - Amount due
- `total_amount` - Total cost
- `status` - 0=pending, 1=confirmed
- `lockid` - FK to lock_bookings

### booking_attendees
- `id` - Primary key
- `booking_ref` - Booking reference (1SRC...)
- `booking_id` - FK to bookings
- `first_name` - First name
- `sur_name` - Surname with order number
- `contact1` - Phone number
- `email` - Email address
- `license_number` - Driving licence
- `rideto_orderid` - RideTo order number
- `contact_card_id` - FK to dropdown
- `primary` - 1 for primary attendee

---

## 🚀 Deployment

### Start Server
```bash
npm start
```

### Development Mode
```bash
npm run dev
```

### Check Server Status
```bash
curl http://localhost:3000/health
```

---

## 📞 Support

For issues or questions:
- **Email**: support@1stoptraining.com
- **Logs**: Check log files in project root
- **Database**: Verify connection with `/db-test` endpoint

---

**Last Updated**: December 2024
**Version**: 1.0.0
