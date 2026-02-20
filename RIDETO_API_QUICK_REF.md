# RideTo Booking API - Quick Reference

## 🔑 Authentication
```
Authorization: Basic NGxDQmJNeFB2U0JYT1lXU2VqOFdBRWRsM1pSRTB2OE80WTZXTVRYTFNjMTAwSDF4anQ=
```

## 📍 Endpoints

### 1. Check Availability
```
POST /api/booking/check-availability
```

**Minimal Request:**
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

**Success Response (200):**
```json
{
  "message": "Course is available",
  "is_available": true,
  "availableSpace": 5,
  "school_course_id": 123
}
```

---

### 2. Confirm Booking
```
POST /api/booking/confirm-booking
```

**Minimal Request:**
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
  "phone": "07700900123"
}
```

**Optional Fields:**
```json
{
  "last_name": "Doe",
  "email": "john@example.com",
  "driving_licence": "SMITH123456AB7CD"
}
```

**Success Response (200):**
```json
{
  "message": "Course is confirmed",
  "school_course_id": 123,
  "booking_ref": "1SRC12345"
}
```

---

## 🔄 Booking Flow

```
1. Check Availability
   ↓ (if available)
2. Lock Space (external API)
   ↓ (get space_hold_id)
3. Confirm Booking
   ↓
4. Get booking_ref
```

---

## ⚠️ Common Errors

| Code | Message | Fix |
|------|---------|-----|
| 401 | Authorization header missing | Add Basic Auth header |
| 400 | Course is not locked | Lock space before confirming |
| 404 | Course is not available | Check course exists |
| 400 | Validation failed | Check required fields |

---

## 📝 Field Formats

- **Date**: `YYYY-MM-DD` (e.g., `2024-12-25`)
- **Time**: `HH:mm` (e.g., `09:00`, `17:30`)
- **Phone**: Any format (spaces removed automatically)
- **Email**: Valid email format
- **Licence**: Any format (converted to uppercase)

---

## 🧪 Quick Test (cURL)

```bash
# Check Availability
curl -X POST http://localhost:3000/api/booking/check-availability \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic NGxDQmJNeFB2U0JYT1lXU2VqOFdBRWRsM1pSRTB2OE80WTZXTVRYTFNjMTAwSDF4anQ=" \
  -d '{"school_course_id":123,"location":"London","course_type":"LICENCE_CBT","date":"2024-12-25","start_time":"09:00","finish_time":"17:00","bike_hire_type":"manual"}'

# Confirm Booking
curl -X POST http://localhost:3000/api/booking/confirm-booking \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic NGxDQmJNeFB2U0JYT1lXU2VqOFdBRWRsM1pSRTB2OE80WTZXTVRYTFNjMTAwSDF4anQ=" \
  -d '{"school_course_id":123,"location":"London","course_type":"LICENCE_CBT","date":"2024-12-25","start_time":"09:00","finish_time":"17:00","bike_hire":"manual","course_event_id":456,"space_hold_id":789,"rideto_order_number":"RT123456","first_name":"John","phone":"07700900123"}'
```

---

## 📊 Response Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request / Validation Error |
| 401 | Unauthorized |
| 404 | Not Found |
| 405 | Method Not Allowed |
| 500 | Server Error |

---

## 📁 Log Files

- `check_availability.log` - Availability checks
- `confirm_booking.log` - Booking confirmations
- `confirm_already_confirm.log` - Duplicate bookings
- `aftersaveattendee.txt` - Attendee saves
- `addBookingsdone.txt` - Bookings done updates

---

## 🔧 Files Modified/Created

### New Files:
- `src/controllers/confirmBooking.js` - Confirm booking logic
- `src/routes/confirmBooking.js` - Confirm booking route
- `RIDETO_BOOKING_API.md` - Full documentation
- `RIDETO_API_QUICK_REF.md` - This file

### Existing Files:
- `src/controllers/checkAvailability.js` - Already exists
- `src/routes/checkAvailability.js` - Already exists
- `src/middleware/basicAuth.js` - Already exists
- `src/index.js` - Updated with new route

---

## 🎯 Key Points

1. ✅ Both endpoints use Basic Auth
2. ✅ Check availability before confirming
3. ✅ Space must be locked before confirming
4. ✅ Duplicate orders are handled automatically
5. ✅ All operations are logged
6. ✅ Email sent on successful booking
7. ✅ Transactions ensure data consistency

---

## 📞 Quick Support

- Health Check: `GET http://localhost:3000/health`
- DB Test: `GET http://localhost:3000/db-test`
- API Docs: `GET http://localhost:3000/api`
