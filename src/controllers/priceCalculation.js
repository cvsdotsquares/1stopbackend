// src/controllers/priceCalculation.js
class PriceCalculationController {
  constructor(pool) {
    this.pool = pool;
  }

  async calculatePrice(req, res) {
    try {
      const { course_event_id, attendees, promo_code_id, apply_deposit_logic = true } = req.body;

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

      // Determine if deposit is required
      const depositRequired = apply_deposit_logic ? 
        this.shouldChargeDeposit(courseEvent, courseEvent.course_event_dates) : false;

      // Calculate totals
      const subtotal = attendeePrices.reduce((sum, price) => sum + price.total, 0);
      const depositTotal = attendeePrices.reduce((sum, price) => sum + price.deposit, 0);

      // Apply promo discount
      const promoData = promo_code_id ? await this.getPromoCode(promo_code_id) : null;
      const amountToDiscount = depositRequired ? depositTotal : subtotal;
      const promoResult = this.applyPromoDiscount(amountToDiscount, promoData, attendees.length);

      // Calculate VAT
      const vatSettings = await this.getVATRate();
      const vatResult = this.calculateVAT(
        promoResult.discounted_amount,
        courseEvent.franchise,
        courseEvent.course,
        vatSettings.vat_rate
      );

      // Final amount calculation
      const finalAmount = promoResult.discounted_amount + vatResult.vat_amount;

      res.json({
        success: true,
        pricing_breakdown: {
          base_prices: attendeePrices,
          deposit_required: depositRequired,
          deposit_reason: depositRequired ? 'Course starts within deposit period' : 'Full payment required',
          promo_discount: {
            applied: !!promoData,
            type: promoData?.p_c_discount_type || null,
            amount: promoData?.p_c_amount || 0,
            total_discount: promoResult.discount
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
        c.course_name, c.deposit_days, c.dsa_fees,
        f.vat, f.franchise_name, f.payment_directly,
        ced.event_date, ced.event_start_time, ced.event_end_time
      FROM course_events ce
      JOIN courses c ON ce.course_id = c.id
      JOIN franchise f ON ce.franchise_id = f.id
      LEFT JOIN course_event_dates ced ON ce.id = ced.course_event_id
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
        dsa_fees: rows[0].dsa_fees
      },
      franchise: {
        vat: rows[0].vat,
        franchise_name: rows[0].franchise_name,
        payment_directly: rows[0].payment_directly
      },
      course_event_dates: rows.filter(row => row.event_date && row.event_date !== '0000-00-00')
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
    // Check if deposit is enabled
    if (courseEvent.school_deposit_price <= 0 || !courseEvent.is_deposit) {
      return false;
    }

    // Get earliest course date
    const validDates = courseEventDates
      .filter(date => date.event_date !== '0000-00-00')
      .map(date => new Date(date.event_date))
      .sort((a, b) => a - b);

    if (validDates.length === 0) {
      return false;
    }

    const firstDate = validDates[0];
    const depositPeriod = courseEvent.course.deposit_days;
    const depositCalcDate = new Date();
    depositCalcDate.setDate(depositCalcDate.getDate() + depositPeriod + 1);

    // If course starts after deposit period, charge deposit only
    return depositCalcDate <= firstDate;
  }

  applyPromoDiscount(baseAmount, promoData, attendeeCount) {
    if (!promoData || !promoData.status) {
      return { discounted_amount: baseAmount, discount: 0 };
    }

    let totalDiscount = 0;

    if (promoData.p_c_discount_type === 'pounds_off') {
      totalDiscount = attendeeCount * promoData.p_c_amount;
    } else if (promoData.p_c_discount_type === 'percent_off') {
      const discountPerAttendee = (baseAmount * promoData.p_c_amount) / 100;
      totalDiscount = attendeeCount * discountPerAttendee;
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
    if (!franchise.vat || vatRate <= 0) {
      return { vat_amount: 0, vat_rate: 0 };
    }

    // DSA fees are VAT exempt
    const vatableAmount = amount >= course.dsa_fees 
      ? (amount - course.dsa_fees) 
      : amount;

    const vatMultiplier = (100 + vatRate) / 100;
    const vatAmount = vatableAmount - (vatableAmount / vatMultiplier);

    return {
      vat_amount: Math.round(vatAmount * 100) / 100,
      vat_rate: vatRate,
      vatable_amount: vatableAmount,
      dsa_exempt: course.dsa_fees
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