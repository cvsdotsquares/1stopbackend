// src/controllers/priceCalculation.js
class PriceCalculationController {
  constructor(pool) {
    this.pool = pool;
  }

  async calculatePrice(req, res) {
    try {
      const { course_event_id, attendees, promo_code_id, promo_eligible_count, apply_deposit_logic = true } = req.body;

      // Fetch course event with related data
      const courseEvent = await this.getCourseEventWithRelations(course_event_id);
      if (!courseEvent) {
        return res.status(404).json({
          success: false,
          message: 'Course event not found'
        });
      }

      // Calculate base prices for each attendee
      const attendeePrices = attendees.map((attendee, index) => {
        const basePrice = this.calculateBasePrice(courseEvent, attendee.vehicle_type);
        return {
          attendee_index: index,
          vehicle_type: attendee.vehicle_type,
          ...basePrice
        };
      });

      // Determine if deposit is available
      const depositResult = apply_deposit_logic ?
        this.shouldChargeDeposit(courseEvent, courseEvent.course_event_dates) : { allowed: false, note: null };
      const depositRequired = typeof depositResult === 'boolean' ? depositResult : depositResult.allowed;

      // Calculate totals
      const subtotal = attendeePrices.reduce((sum, price) => sum + price.total, 0);
      const depositTotal = attendeePrices.reduce((sum, price) => sum + price.deposit, 0);

      // Apply promo discount (with support for partial eligibility)
      const promoData = promo_code_id ? await this.getPromoCode(promo_code_id) : null;
      const amountToDiscount = depositRequired ? depositTotal : subtotal;
      const eligibleCount = promo_eligible_count !== undefined ? promo_eligible_count : attendees.length;
      const promoResult = this.applyPromoDiscount(amountToDiscount, promoData, attendees.length, eligibleCount);

      // VAT disabled for current pricing flow
      const vatResult = this.calculateVAT(
        promoResult.discounted_amount,
        courseEvent.franchise,
        courseEvent.course,
        0
      );

      // Final amount calculation
      const finalAmount = promoResult.discounted_amount + vatResult.vat_amount;

      res.json({
        success: true,
        pricing_breakdown: {
          base_prices: attendeePrices,
          deposit_required: depositRequired,
          deposit_days: courseEvent.course?.deposit_days || 0,
          deposit_note: depositResult.note || null,
          deposit_reason: depositRequired ? 'Deposit payment - course is far enough from start date' : 'Full payment required - course starts within deposit period',
          promo_discount: {
            applied: !!promoData,
            type: promoData?.p_c_discount_type || null,
            amount: promoData?.p_c_amount || 0,
            total_discount: promoResult.discount,
            eligible_attendee_count: eligibleCount,
            attendee_count: attendees.length
          },
          vat_calculation: vatResult,
          final_totals: {
            subtotal: subtotal,
            discount: promoResult.discount,
            vat: vatResult.vat_amount,
            final_amount: finalAmount,
            amount_to_charge: finalAmount
          }
        }
      });

    } catch (error) {
      console.error('Price calculation error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getCourseEventWithRelations(courseEventId) {
    const query = `
      SELECT
        ce.*,
        c.course_name, c.deposit_days, c.cancel_days, c.dsa_fees,
        f.vat, f.franchise_name, f.payment_directly,
        DATE_FORMAT(ced.event_date, '%Y-%m-%d') as event_date,
        TIME_FORMAT(ced.event_start_time, '%H:%i') as event_start_time,
        TIME_FORMAT(ced.event_end_time, '%H:%i') as event_end_time
      FROM course_events ce
      JOIN courses c ON ce.course_id = c.id
      JOIN franchise f ON ce.franchise_id = f.id
      LEFT JOIN course_event_dates ced ON ce.id = ced.course_event_id
        AND ced.event_date > '1900-01-01'
        AND ced.event_date NOT IN ('1111-11-11', '0000-00-00')
      WHERE ce.id = ? AND ce.status = '1' AND c.status = '1'
      ORDER BY ced.event_date ASC
    `;

    const [rows] = await this.pool.execute(query, [courseEventId]);
    if (rows.length === 0) return null;

    // Group dates for the same event
    const courseEvent = {
      ...rows[0],
      course: {
        course_name: rows[0].course_name,
        deposit_days: rows[0].deposit_days,
        cancel_days: rows[0].cancel_days,
        dsa_fees: rows[0].dsa_fees
      },
      franchise: {
        vat: rows[0].vat,
        franchise_name: rows[0].franchise_name,
        payment_directly: rows[0].payment_directly
      },
      course_event_dates: rows.filter(row => row.event_date)
        .map(row => ({
          event_date: row.event_date,
          event_start_time: row.event_start_time,
          event_end_time: row.event_end_time
        }))
    };

    return courseEvent;
  }

  calculateBasePrice(courseEvent, vehicleType) {
    // Priority 1: One-off pricing (full payment only)
    if (courseEvent.school_one_off_price > 0 || courseEvent.own_one_off_price > 0) {
      if (vehicleType === 3) { // Own vehicle
        return {
          total: courseEvent.own_one_off_price || 0,
          deposit: courseEvent.own_one_off_price || 0,
          pricing_type: 'one_off'
        };
      } else { // School vehicle (Manual/Automatic)
        return {
          total: courseEvent.school_one_off_price || 0,
          deposit: courseEvent.school_one_off_price || 0,
          pricing_type: 'one_off'
        };
      }
    }

    // Priority 2: Deposit + Total pricing
    if (courseEvent.school_deposit_price > 0 || courseEvent.own_deposit_price > 0) {
      if (vehicleType === 3) { // Own vehicle
        return {
          total: courseEvent.own_total_price || courseEvent.own_deposit_price,
          deposit: courseEvent.own_deposit_price || 0,
          pricing_type: 'deposit_total'
        };
      } else { // School vehicle
        return {
          total: courseEvent.school_total_price || courseEvent.school_deposit_price,
          deposit: courseEvent.school_deposit_price || 0,
          pricing_type: 'deposit_total'
        };
      }
    }

    return { total: 0, deposit: 0, pricing_type: 'free' };
  }

  shouldChargeDeposit(courseEvent, courseEventDates) {

    const depositCutoffDays = Number.parseInt(courseEvent.course?.cancel_days) || 0;

    // Check if deposit pricing is configured
    if (courseEvent.school_deposit_price <= 0) {
      return { allowed: false, note: 'No deposit pricing configured for this course.' };
    }

    // If is_deposit = 0 (unchecked), deposit period check is DISABLED - always allow deposit
    if (!courseEvent.is_deposit || courseEvent.is_deposit === 0) {
      return { allowed: true, note: null };
    }

    // Get earliest course date
    const validDates = courseEventDates
    .flatMap(({ event_date }) => {
      if (
        !event_date ||
        event_date === '0000-00-00' ||
        event_date === '1111-11-11'
      ) {
        return [];
      }

      if (typeof event_date === 'string') {
        const ymd = event_date.slice(0, 10);
        if (ymd === '0000-00-00' || ymd === '1111-11-11' || ymd.startsWith('0000-')) {
          return [];
        }
      }
  
      const date = new Date(event_date);
      if (isNaN(date.getTime())) {
        return [];
      }

      // Reject MySQL zero-date conversions (often land in 1899/1900)
      const year = date.getFullYear();
      if (year < 2000 || year === 1111) {
        return [];
      }

      return [date];
    })
    .sort((a, b) => a - b);


    if (validDates.length === 0) {
      return { allowed: false, note: 'Deposit option is unavailable as the course dates are yet to be confirmed.' };
    }

    const firstDate = validDates[0];
    const depositPeriod = depositCutoffDays;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const courseStartDate = new Date(firstDate);
    courseStartDate.setHours(0, 0, 0, 0);
    const diffTime = courseStartDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // If days until course > deposit_days, deposit is allowed
    // If days until course <= deposit_days, require full payment
    const shouldCharge = diffDays > depositPeriod;

    if (shouldCharge) {
      return { allowed: true, note: null };
    } else {
      return {
        allowed: false,
        note: `Deposit option is only available when booking at least ${depositPeriod} days before the course start date. Full payment is required for this date.`
      };
    }
  }

  applyPromoDiscount(baseAmount, promoData, attendeeCount, eligibleAttendeeCount = null) {
    if (!promoData || !promoData.status) {
      return { discounted_amount: baseAmount, discount: 0 };
    }

    // Use eligible count if provided, otherwise use all attendees
    const safeEligibleCount = Math.max(0, eligibleAttendeeCount !== null ? eligibleAttendeeCount : attendeeCount);
    const safeAttendeeCount = Math.max(1, attendeeCount);

    let totalDiscount = 0;

    if (promoData.p_c_discount_type === 'pounds_off') {
      // Apply discount amount for each eligible attendee
      totalDiscount = safeEligibleCount * promoData.p_c_amount;
    } else if (promoData.p_c_discount_type === 'percent_off') {
      // Calculate percent discount based on eligible attendees' proportion
      const eligibleRatio = safeAttendeeCount > 0 ? (safeEligibleCount / safeAttendeeCount) : 0;
      const eligibleBaseAmount = baseAmount * eligibleRatio;
      totalDiscount = (eligibleBaseAmount * promoData.p_c_amount) / 100;
    }

    const discountedAmount = Math.max(0, baseAmount - totalDiscount);

    return {
      discounted_amount: discountedAmount,
      discount: totalDiscount,
      discount_type: promoData.p_c_discount_type,
      discount_rate: promoData.p_c_amount
    };
  }

  calculateVAT(amount, franchise, course, vatRate) {
    return {
      vat_amount: 0,
      vat_rate: 0,
      vatable_amount: 0,
      dsa_exempt: course?.dsa_fees || 0
    };
  }

  async getPromoCode(promoCodeId) {
    const query = `
      SELECT * FROM promos
      WHERE id = ? AND status = 1 AND isDeleted = 0
      AND (p_c_expiry = 0 OR p_c_expiry_date >= CURDATE())
    `;

    const [rows] = await this.pool.execute(query, [promoCodeId]);
    return rows[0] || null;
  }

  async getVATRate() {
    const query = 'SELECT vat_rate FROM settings ORDER BY id DESC LIMIT 1';
    const [rows] = await this.pool.execute(query);
    return rows[0] || { vat_rate: 20 }; // Default 20% VAT
  }

  // Validation endpoint for course events
  async validateCourseEvent(req, res) {
    try {
      const { course_event_id } = req.params;

      const courseEvent = await this.getCourseEventWithRelations(course_event_id);
      if (!courseEvent) {
        return res.status(404).json({
          success: false,
          message: 'Course event not found or inactive'
        });
      }

      // Check if event has valid pricing
      const hasValidPricing =
        courseEvent.school_one_off_price > 0 ||
        courseEvent.own_one_off_price > 0 ||
        courseEvent.school_deposit_price > 0 ||
        courseEvent.own_deposit_price > 0;

      if (!hasValidPricing) {
        return res.status(400).json({
          success: false,
          message: 'Course event has no valid pricing configured'
        });
      }

      res.json({
        success: true,
        data: {
          course_event_id: courseEvent.id,
          course_name: courseEvent.course.course_name,
          location_id: courseEvent.location_id,
          franchise_id: courseEvent.franchise_id,
          pricing_available: true,
          deposit_enabled: courseEvent.is_deposit === 1,
          dates: courseEvent.course_event_dates
        }
      });

    } catch (error) {
      console.error('Course event validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Get available pricing options for a course event
  async getPricingOptions(req, res) {
    try {
      const { course_event_id } = req.params;

      const courseEvent = await this.getCourseEventWithRelations(course_event_id);
      if (!courseEvent) {
        return res.status(404).json({
          success: false,
          message: 'Course event not found'
        });
      }

      const pricingOptions = {
        school_vehicle: {
          one_off_price: courseEvent.school_one_off_price || 0,
          deposit_price: courseEvent.school_deposit_price || 0,
          total_price: courseEvent.school_total_price || 0
        },
        own_vehicle: {
          one_off_price: courseEvent.own_one_off_price || 0,
          deposit_price: courseEvent.own_deposit_price || 0,
          total_price: courseEvent.own_total_price || 0
        },
        deposit_enabled: courseEvent.is_deposit === 1,
        deposit_days: courseEvent.course.deposit_days,
        dsa_fees: courseEvent.course.dsa_fees,
        vat_applicable: courseEvent.franchise.vat === 1
      };

      res.json({
        success: true,
        data: pricingOptions
      });

    } catch (error) {
      console.error('Get pricing options error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = PriceCalculationController;