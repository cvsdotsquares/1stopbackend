class SubscriberController {
    constructor(pool) {
        this.pool = pool;

        // bind methods
        this.subscribe = this.subscribe.bind(this);
    }

    async subscribe(req, res) {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is required'
                });
            }

            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid email address'
                });
            }

            // Check duplicate
            const [existing] = await this.pool.execute(
                'SELECT id FROM newsletter_subscribers WHERE email = ?',
                [email]
            );

            if (existing.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already subscribed'
                });
            }

            // Insert subscriber
            await this.pool.execute(
                'INSERT INTO newsletter_subscribers (email) VALUES (?)',
                [email]
            );

            return res.status(201).json({
                success: true,
                message: 'Subscribed successfully'
            });

        } catch (error) {
            console.error('Subscribe Error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

module.exports = SubscriberController;
