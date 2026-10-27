// src/controllers/attendeeData.js
class AttendeeController {
    constructor(pool) {
        this.pool = pool;
    }

    async getAttendeeNames(req, res) {
        try {
            const { refId } = req.params;

            if (!refId) {
                return res.status(400).json({ success: false, message: 'refId is required' });
            }

            const [attendees] = await this.pool.query(
                `
                    SELECT booking_ref, first_name, sur_name
                    FROM booking_attendees
                    WHERE booking_ref = ?
                `,
                [refId]
            );

            if (!attendees.length) {
                return res.status(404).json({ success: false, message: 'Attendee not found' });
            }

            return res.json({
                success: true,
                data: [{ booking_ref: attendees[0].booking_ref, names: { firstname: attendees[0].first_name, surname: attendees[0].sur_name } }],
            });
        } catch (error) {
            console.error('Get attendee by ref error:', error);
            return res.status(500).json({ success: false, message: 'Failed to get attendee names' });
        }
    }

    async getAttendeeNamesByRefs(req, res) {
        try {
            const { booking_refs } = req.body || {};

            if (!Array.isArray(booking_refs) || booking_refs.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'booking_refs must be a non-empty array',
                });
            }

            const refs = booking_refs
                .map((ref) => String(ref || '').trim())
                .filter(Boolean);

            if (!refs.length) {
                return res.status(400).json({
                    success: false,
                    message: 'booking_refs must contain valid values',
                });
            }

            const placeholders = refs.map(() => '?').join(',');
            const [attendees] = await this.pool.query(
                `
                    SELECT booking_ref, first_name, sur_name
                    FROM booking_attendees
                    WHERE booking_ref IN (${placeholders})
                    ORDER BY FIELD(booking_ref, ${placeholders})
                `,
                [...refs, ...refs]
            );

            return res.json({
                success: true,
                data: attendees.map(attendee => ({ booking_ref: attendee.booking_ref, name: { firstname: attendee.first_name, surname: attendee.sur_name } })),
            });
        } catch (error) {
            console.error('Get attendees by refs error:', error);
            return res.status(500).json({ success: false, message: 'Failed to get attendee names' });
        }
    }
}

module.exports = AttendeeController;