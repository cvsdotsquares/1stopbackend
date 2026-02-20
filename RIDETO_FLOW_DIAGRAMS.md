# RideTo Booking API - Flow Diagrams

## 🔄 Complete Booking Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         RideTo System                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1. Check Availability
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  POST /api/booking/check-availability                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ • Validate Basic Auth                                     │  │
│  │ • Validate Request Fields                                 │  │
│  │ • Query booking_status table                              │  │
│  │ • Check availableSpace >= 1                               │  │
│  │ • Return availability status                              │  │
│  │ • Log to check_availability.log                           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Response: is_available: true
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RideTo System                                 │
│  • Lock space (external API - not implemented here)             │
│  • Get space_hold_id                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 2. Confirm Booking
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  POST /api/booking/confirm-booking                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Step 1: Validate Basic Auth                               │  │
│  │ Step 2: Validate Request Fields                           │  │
│  │ Step 3: Check Space Lock                                  │  │
│  │         ├─ Query lock_bookings                            │  │
│  │         └─ If not found → Return 400 "not locked"         │  │
│  │                                                            │  │
│  │ Step 4: Check Duplicate Order                             │  │
│  │         ├─ Query booking_attendees                        │  │
│  │         ├─ Query booking_attendees_dropdown               │  │
│  │         └─ If found → Remove lock, Return 200             │  │
│  │                                                            │  │
│  │ Step 5: Fetch Booking Status                              │  │
│  │         └─ Query booking_status for course details        │  │
│  │                                                            │  │
│  │ Step 6: Create Booking                                    │  │
│  │         ├─ INSERT into bookings                           │  │
│  │         ├─ Get bookingId                                  │  │
│  │         └─ Generate booking_ref = '1SRC' + bookingId      │  │
│  │                                                            │  │
│  │ Step 7: Save Contact Card                                 │  │
│  │         ├─ Check booking_attendees_dropdown               │  │
│  │         ├─ INSERT or UPDATE contact card                  │  │
│  │         └─ Get contact_card_id                            │  │
│  │                                                            │  │
│  │ Step 8: Save Attendee                                     │  │
│  │         ├─ INSERT into booking_attendees                  │  │
│  │         └─ Log to aftersaveattendee.txt                   │  │
│  │                                                            │  │
│  │ Step 9: Create/Link User                                  │  │
│  │         ├─ Check users table by email                     │  │
│  │         ├─ INSERT if not exists                           │  │
│  │         └─ UPDATE booking with user_id                    │  │
│  │                                                            │  │
│  │ Step 10: Complete Booking                                 │  │
│  │          ├─ UPDATE booking status = 1                     │  │
│  │          └─ INSERT into booking_payments                  │  │
│  │                                                            │  │
│  │ Step 11: Update Course Events                             │  │
│  │          ├─ UPDATE bookings_done + 1                      │  │
│  │          └─ Log to addBookingsdone.txt                    │  │
│  │                                                            │  │
│  │ Step 12: Remove Lock                                      │  │
│  │          ├─ DELETE from lock_bookings                     │  │
│  │          └─ UPDATE current_locks - 1                      │  │
│  │                                                            │  │
│  │ Step 13: Send Email                                       │  │
│  │          ├─ Send via Postmark SMTP                        │  │
│  │          └─ To: bookings@1stopinstruction.com             │  │
│  │                                                            │  │
│  │ Step 14: Return Success                                   │  │
│  │          ├─ Return booking_ref                            │  │
│  │          └─ Log to confirm_booking.log                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Response: booking_ref: "1SRC12345"
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         RideTo System                            │
│  • Store booking_ref                                             │
│  • Show confirmation to customer                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Client Request                              │
│  Headers:                                                        │
│    Authorization: Basic <base64_token>                           │
│    Content-Type: application/json                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Basic Auth Middleware                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Check Authorization header exists                      │  │
│  │    └─ If missing → Return 401                             │  │
│  │                                                            │  │
│  │ 2. Extract base64 token                                   │  │
│  │    └─ Remove "Basic " prefix                              │  │
│  │                                                            │  │
│  │ 3. Decode base64 to plain text                            │  │
│  │                                                            │  │
│  │ 4. Compare with valid token                               │  │
│  │    └─ If invalid → Return 401                             │  │
│  │                                                            │  │
│  │ 5. If valid → Continue to controller                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Controller Logic                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Database Transaction Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Start Transaction                             │
│                    BEGIN TRANSACTION                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Database Operations (in order)                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. SELECT from lock_bookings (validate lock)             │  │
│  │ 2. SELECT from booking_attendees (check duplicate)       │  │
│  │ 3. SELECT from booking_attendees_dropdown (check dup)    │  │
│  │ 4. SELECT from booking_status (get course details)       │  │
│  │ 5. INSERT into bookings (create booking)                 │  │
│  │ 6. SELECT/INSERT/UPDATE booking_attendees_dropdown       │  │
│  │ 7. INSERT into booking_attendees (save attendee)         │  │
│  │ 8. SELECT/INSERT into users (user management)            │  │
│  │ 9. UPDATE bookings (set user_id, status)                 │  │
│  │ 10. INSERT into booking_payments (record payment)        │  │
│  │ 11. SELECT from course_events (get parent)               │  │
│  │ 12. UPDATE course_events (increment bookings_done)       │  │
│  │ 13. DELETE from lock_bookings (remove lock)              │  │
│  │ 14. UPDATE course_events (decrement current_locks)       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────┴─────────┐
                    │                   │
                 Success             Error
                    │                   │
                    ▼                   ▼
        ┌───────────────────┐  ┌───────────────────┐
        │      COMMIT       │  │     ROLLBACK      │
        │  All changes      │  │  Undo all changes │
        │  saved to DB      │  │  Return error     │
        └───────────────────┘  └───────────────────┘
```

---

## 🔄 Duplicate Order Handling

```
┌─────────────────────────────────────────────────────────────────┐
│              Check Duplicate Order                               │
│  Query: SELECT * FROM booking_attendees                          │
│         WHERE rideto_orderid = ?                                 │
│                                                                  │
│  Query: SELECT * FROM booking_attendees_dropdown                 │
│         WHERE rideto_orderid = ?                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                 Found              Not Found
                    │                   │
                    ▼                   ▼
        ┌───────────────────┐  ┌───────────────────┐
        │  Duplicate Order  │  │   New Order       │
        │  ┌─────────────┐  │  │  ┌─────────────┐  │
        │  │ 1. Remove   │  │  │  │ 1. Create   │  │
        │  │    Lock     │  │  │  │    Booking  │  │
        │  │             │  │  │  │             │  │
        │  │ 2. Return   │  │  │  │ 2. Process  │  │
        │  │    200 OK   │  │  │  │    Payment  │  │
        │  │             │  │  │  │             │  │
        │  │ 3. Log to   │  │  │  │ 3. Send     │  │
        │  │    confirm_ │  │  │  │    Email    │  │
        │  │    already_ │  │  │  │             │  │
        │  │    confirm  │  │  │  │ 4. Return   │  │
        │  │    .log     │  │  │  │    booking_ │  │
        │  │             │  │  │  │    ref      │  │
        │  └─────────────┘  │  │  └─────────────┘  │
        └───────────────────┘  └───────────────────┘
```

---

## 📧 Email Notification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              After Successful Booking                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Send Email via Postmark                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Configuration:                                            │  │
│  │   Host: smtp.postmarkapp.com                              │  │
│  │   Port: 587 (TLS)                                         │  │
│  │   Auth: b39d5268-a4be-49ac-8f23-27c74d9126bf              │  │
│  │                                                            │  │
│  │ Email Details:                                            │  │
│  │   From: info@1stopinstruction.com                         │  │
│  │   To: bookings@1stopinstruction.com                       │  │
│  │   Subject: [Course] Booking Confirmation - [Ref]          │  │
│  │                                                            │  │
│  │ Content:                                                  │  │
│  │   • Booking Reference                                     │  │
│  │   • Customer Name                                         │  │
│  │   • Course Name                                           │  │
│  │   • RideTo Order Number                                   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                 Success             Failed
                    │                   │
                    ▼                   ▼
        ┌───────────────────┐  ┌───────────────────┐
        │  Email Sent       │  │  Email Failed     │
        │  • Log success    │  │  • Log error      │
        │  • Continue       │  │  • Continue       │
        │    (non-blocking) │  │    (non-blocking) │
        └───────────────────┘  └───────────────────┘
```

---

## 🗂️ File Structure

```
1stopbackend/
│
├── src/
│   ├── controllers/
│   │   ├── checkAvailability.js      ✅ Existing
│   │   └── confirmBooking.js         ✅ NEW
│   │
│   ├── routes/
│   │   ├── checkAvailability.js      ✅ Existing
│   │   └── confirmBooking.js         ✅ NEW
│   │
│   ├── middleware/
│   │   └── basicAuth.js              ✅ Existing
│   │
│   ├── utils/
│   │   └── emailService.js           ✅ Existing
│   │
│   └── index.js                      ✅ Updated
│
├── Log Files (created at runtime):
│   ├── check_availability.log
│   ├── confirm_booking.log
│   ├── confirm_already_confirm.log
│   ├── aftersaveattendee.txt
│   └── addBookingsdone.txt
│
└── Documentation:
    ├── RIDETO_BOOKING_API.md         ✅ NEW
    ├── RIDETO_API_QUICK_REF.md       ✅ NEW
    ├── RIDETO_IMPLEMENTATION_SUMMARY.md ✅ NEW
    ├── RIDETO_FLOW_DIAGRAMS.md       ✅ NEW (this file)
    └── RideTo_Booking_API.postman_collection.json ✅ NEW
```

---

## 🎯 Request/Response Flow

### Check Availability

```
Request                          Processing                      Response
───────                          ──────────                      ────────

POST /check-availability    →    Validate Auth              →    200 OK
{                                     ↓                          {
  school_course_id: 123          Validate Fields                  "is_available": true,
  location: "London"                  ↓                            "availableSpace": 5
  date: "2024-12-25"             Query Database                 }
  start_time: "09:00"                 ↓
  ...                            Check Spaces                 OR
}                                     ↓
                                 Log Request                  →    400/404
                                     ↓                          {
                                 Return Result                    "is_available": false
                                                                }
```

### Confirm Booking

```
Request                          Processing                      Response
───────                          ──────────                      ────────

POST /confirm-booking       →    Validate Auth              →    200 OK
{                                     ↓                          {
  course_event_id: 456           Validate Fields                  "message": "confirmed",
  space_hold_id: 789                  ↓                            "booking_ref": "1SRC123"
  rideto_order_number: "RT1"     Check Lock                     }
  first_name: "John"                  ↓
  phone: "07700900123"           Check Duplicate             OR
  ...                                 ↓
}                                Create Booking              →    400
                                     ↓                          {
                                 Save Attendee                    "message": "not locked"
                                     ↓                          }
                                 Update Events
                                     ↓                       OR
                                 Remove Lock
                                     ↓                       →    400
                                 Send Email                     {
                                     ↓                            "message": "not available"
                                 Log All Steps                  }
                                     ↓
                                 Return booking_ref
```

---

## 📊 Database Tables Relationship

```
┌─────────────────────┐
│   lock_bookings     │
│  ┌──────────────┐   │
│  │ id           │───┼──────────────────┐
│  │ event_id     │   │                  │
│  └──────────────┘   │                  │
└─────────────────────┘                  │
                                         │
┌─────────────────────┐                  │
│  booking_status     │                  │
│  ┌──────────────┐   │                  │
│  │ courseId     │   │                  │
│  │ eventId      │   │                  │
│  │ course_cost  │   │                  │
│  └──────────────┘   │                  │
└─────────────────────┘                  │
         │                               │
         │                               │
         ▼                               │
┌─────────────────────┐                  │
│     bookings        │                  │
│  ┌──────────────┐   │                  │
│  │ id           │───┼──────┐           │
│  │ course_id    │   │      │           │
│  │ user_id      │   │      │           │
│  │ lockid       │───┼──────┼───────────┘
│  │ status       │   │      │
│  └──────────────┘   │      │
└─────────────────────┘      │
         │                   │
         │                   │
         ▼                   ▼
┌─────────────────────┐  ┌─────────────────────┐
│ booking_attendees   │  │ booking_payments    │
│  ┌──────────────┐   │  │  ┌──────────────┐   │
│  │ booking_id   │───┤  │  │ booking_id   │───┤
│  │ booking_ref  │   │  │  │ amount       │   │
│  │ contact_card │───┼─┐│  │ payment_type │   │
│  │ rideto_order │   │ ││  └──────────────┘   │
│  └──────────────┘   │ │└─────────────────────┘
└─────────────────────┘ │
                        │
                        ▼
┌─────────────────────────────────┐
│ booking_attendees_dropdown      │
│  ┌──────────────┐               │
│  │ id           │               │
│  │ license_num  │               │
│  │ rideto_order │               │
│  └──────────────┘               │
└─────────────────────────────────┘

┌─────────────────────┐
│   course_events     │
│  ┌──────────────┐   │
│  │ id           │   │
│  │ parent       │   │
│  │ bookings_done│   │
│  │ current_locks│   │
│  └──────────────┘   │
└─────────────────────┘

┌─────────────────────┐
│       users         │
│  ┌──────────────┐   │
│  │ id           │   │
│  │ email        │   │
│  │ first_name   │   │
│  └──────────────┘   │
└─────────────────────┘
```

---

## ✅ Success Criteria Checklist

```
┌─────────────────────────────────────────────────────────────────┐
│                    Implementation Checklist                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ Basic Auth middleware working                                │
│  ✅ Check availability endpoint functional                       │
│  ✅ Confirm booking endpoint created                             │
│  ✅ Request validation implemented                               │
│  ✅ Database transactions working                                │
│  ✅ Lock validation implemented                                  │
│  ✅ Duplicate order detection working                            │
│  ✅ Booking creation successful                                  │
│  ✅ Attendee management working                                  │
│  ✅ User account creation/linking                                │
│  ✅ Payment recording functional                                 │
│  ✅ Course events updating                                       │
│  ✅ Lock removal working                                         │
│  ✅ Email notifications sending                                  │
│  ✅ Comprehensive logging implemented                            │
│  ✅ Error handling with rollback                                 │
│  ✅ Documentation complete                                       │
│  ✅ Postman collection created                                   │
│  ✅ Testing examples provided                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

**Last Updated**: December 2024
**Status**: ✅ Complete
