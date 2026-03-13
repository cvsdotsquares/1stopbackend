# Booking Payment Issue - Critical Fixes Implemented

## Problem Summary

The system had critical issues where failed/declined payments were still creating bookings and sending confirmation emails while spaces remained occupied:

1. ❌ **Email sent before payment confirmed** - Confirmations sent immediately after booking creation, not after payment success
2. ❌ **Bookings created despite payment failure** - Database records created before payment confirmation
3. ❌ **Spaces not freed on failed payments** - `current_locks` not properly released when payment failed
4. ❌ **Booking references created prematurely** - References created before payment confirmation

---

## Solutions Implemented

### 1. Email Confirmation Flow - Payment-First Architecture

**File: `src/controllers/bookingFlow.js`**

**Change**: Removed email sending from booking creation method
```javascript
// REMOVED: sendBookingConfirmation() call after booking creation
// NOTE: Email is NOT sent here anymore. It will be sent by the Stripe webhook
// when payment is successfully confirmed. This prevents sending confirmation
// emails for failed/declined payments.
```

**Why**: Emails are now sent ONLY when payment succeeds via webhook, not during booking creation.

---

### 2. Email Sent on Payment Success

**File: `src/controllers/stripeWebhook.js`**

**New Method**: `sendBookingConfirmationEmail(booking_id)`
- Called immediately after `payment_intent.succeeded` webhook is processed
- Retrieves booking details from database
- Sends confirmation with **actual paid amount** (from Stripe), not the configured deposit amount
- Gathers course, location, franchise, and attendee details
- Includes proper email metadata (BCC, HTML templates, etc.)

**Implementation**:
```javascript
// After payment is confirmed and committed to database
try {
  await this.sendBookingConfirmationEmail(booking_id);
} catch (emailError) {
  console.error('Failed to send confirmation email:', emailError);
  // Email failure doesn't fail payment confirmation
}
```

---

### 3. Payment Failure Cleanup - Enhanced Robustness

**File: `src/controllers/stripeWebhook.js`**

**Enhanced Methods**:
- `handlePaymentFailed(paymentIntent)`
- `handlePaymentCanceled(paymentIntent)`
- `handlePaymentExpired(session)`

**Key Improvements**:

#### A. Row Locking
```javascript
// Prevents race conditions - ensures booking can't be modified while cleaning up
const [bookings] = await connection.query(`
  SELECT id, spaces, course_event_id FROM bookings
  WHERE id = ? FOR UPDATE
`, [booking_id]);
```

#### B. Double-Check Payment Status
```javascript
// Ensure booking wasn't already paid before cleaning up
const [bookingStatus] = await connection.query(`
  SELECT status, admin_payment_received FROM bookings WHERE id = ?
`);

if (bookingStatus[0].admin_payment_received > 0) {
  // Already paid - don't delete!
  return;
}
```

#### C. Guaranteed Space Release
```javascript
// CRITICAL: Always release locks when payment fails
await connection.query(`
  UPDATE course_events
  SET current_locks = GREATEST(0, current_locks - ?),
      modified = NOW()
  WHERE id = ?
`, [booking.spaces, booking.course_event_id]);
```

#### D. Complete Cleanup
When payment fails, the system now:
1. Releases `current_locks` from course_events
2. Deletes `booking_attendees` (which contains booking references)
3. Deletes `booking_attendees_dropdown`
4. Deletes the `bookings` record

This ensures **NO leftover data** for failed bookings.

---

## Flow Diagram - After Fixes

### Success Path
```
1. User creates booking → Booking created with status=0 (unpaid)
2. Spaces reserved with current_locks++
3. Stripe PaymentIntent returned to frontend
4. User completes payment on Stripe
5. ✅ payment_intent.succeeded webhook received
6. current_locks → bookings_done
7. status → 1 (confirmed)
8. 📧 Confirmation email sent with ACTUAL amount paid
9. ✅ Booking confirmed!
```

### Failure Path
```
1. User creates booking → Booking created with status=0 (unpaid)
2. Spaces reserved with current_locks++
3. Stripe PaymentIntent returned to frontend
4. Payment fails/declined/canceled
5. ❌ payment_intent.payment_failed webhook received
6. 🔓 current_locks-- (spaces released)
7. 🗑️ booking deleted
8. 🗑️ attendees deleted
9. ❌ NO email sent
10. NO leftover data
```

---

## Edge Cases Handled

### Edge Case 1: Webhook Received Twice
**Idempotency Check**:
```javascript
// Payment success already checks for existing payment record
const [existingPayment] = await connection.query(`
  SELECT id FROM booking_payments WHERE transation_id = ?
`);

if (existingPayment.length > 0) {
  console.log('Payment already processed');
  return;
}
```

### Edge Case 2: Concurrent Requests
**Row Locking**:
```javascript
// Prevents race conditions with FOR UPDATE lock
SELECT id, spaces, course_event_id FROM bookings WHERE id = ? FOR UPDATE
```

### Edge Case 3: Payment Timeout
**Handled by**: `handlePaymentExpired()`
- Releases locks
- Cleans up all booking data
- No email sent

### Edge Case 4: User Cancels Payment
**Handled by**: `handlePaymentCanceled()`
- Same cleanup as payment failure
- Spaces are freed
- Booking deleted

### Edge Case 5: Booking Already Paid
**Double-Check**:
```javascript
// Won't delete a booking that's already been paid
if (booking.admin_payment_received > 0) {
  return; // Don't cleanup paid bookings!
}
```

---

## Database State Guarantees

### After Successful Payment:
```
bookings table:
  - status = 1 (confirmed)
  - admin_payment_received > 0
  - spaces reserved in bookings_done

booking_payments table:
  - Payment record created
  - Transaction ID stored
```

### After Failed Payment:
```
bookings table:
  - DELETED (no record exists)

booking_attendees table:
  - DELETED (no record exists)

course_events table:
  - current_locks reduced
  - No spaces wasted
```

---

## Logging & Debugging

All webhook handlers now include detailed logging:

```javascript
console.log(`💼 Processing payment for existing booking ${booking_id}`);
console.log(`✅ Decremented current_locks by ${bookingSpaces}`);
console.log(`❌ Payment failed for booking ${booking.id}`);
console.log(`🔓 Released ${booking.spaces} locks`);
console.log(`🗑️ Deleted booking ${booking.id}`);
console.log(`📧 Booking confirmation email sent`);
```

**To debug**: Check Stripe webhook logs in production with these emoji prefixes.

---

## Testing Checklist

- [ ] Create booking → Complete payment → Email received ✓
- [ ] Create booking → Decline payment → No email, spaces freed ✓
- [ ] Create booking → Cancel payment → No email, spaces freed ✓
- [ ] Create booking → Payment timeout → No email, spaces freed ✓
- [ ] Webhook called twice → Only one email sent ✓
- [ ] Concurrent bookings → No race conditions ✓
- [ ] Check database → No orphaned records ✓
- [ ] Email contains actual paid amount (not preset deposit) ✓

---

## Summary of Changed Files

### 1. `src/controllers/bookingFlow.js`
- **Removed**: Email sending after booking creation
- **Impact**: Emails now only sent after payment confirmation

### 2. `src/controllers/stripeWebhook.js`
- **Added**: `sendBookingConfirmationEmail()` method
- **Enhanced**: `handlePaymentSuccess()` to call email after payment
- **Enhanced**: `handlePaymentFailed()` with row locking and double-checks
- **Enhanced**: `handlePaymentCanceled()` with same improvements
- **Enhanced**: `handlePaymentExpired()` with space release guarantee
- **Impact**: All payment states properly handled with guaranteed space release

---

## Future Improvements

1. **Scheduled Cleanup Job**: Add a cron job to clean up orphaned bookings older than 24 hours
   - File: `src/cron/cleanupFailedBookings.js`
   - Catches edge cases where webhooks are lost

2. **Payment Status Dashboard**: Display real-time payment status
   - Show which bookings are pending payment
   - Monitor failed payment attempts

3. **Webhook Replay Logic**: Stripe webhook replay support
   - Ensures no data loss if webhooks are retried

4. **Audit Log**: Track all booking and payment changes
   - For compliance and debugging

---

## Contact & Support

For questions about these fixes, refer to:
- Stripe Webhook Documentation: https://stripe.com/docs/webhooks
- Payment Intent States: https://stripe.com/docs/api/payment_intents/object#payment_intent_object-status
- Database Transaction Safety: Check MySQL row locking documentation
