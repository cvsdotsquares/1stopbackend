# PowerShell Booking System Test Script
# test-bookings.ps1

$baseUrl = "http://localhost:3000"
$headers = @{"Content-Type" = "application/json"}

Write-Host "🚀 Starting Booking System Tests (PowerShell)" -ForegroundColor Green

# Test 1: Health Check
Write-Host "`n1️⃣ Testing API Health..." -ForegroundColor Blue
try {
    $healthResponse = Invoke-WebRequest -Uri "$baseUrl/health" -Method GET
    $health = $healthResponse.Content | ConvertFrom-Json
    Write-Host "✅ API is healthy: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 2: Try to register a test user
Write-Host "`n2️⃣ Registering test user..." -ForegroundColor Blue
$registerBody = @{
    first_name = "Test"
    sur_name = "Booking"
    email = "testbooking@example.com"
    password = "TestPass123!"
    contact1 = "07123456789"
    date_of_birth = "1990-01-01"
} | ConvertTo-Json

try {
    $registerResponse = Invoke-WebRequest -Uri "$baseUrl/api/auth/register" -Method POST -Headers $headers -Body $registerBody
    $registerResult = $registerResponse.Content | ConvertFrom-Json
    Write-Host "✅ User registered successfully" -ForegroundColor Green
} catch {
    $errorContent = $_.ErrorDetails.Message
    if ($errorContent -match "already exists") {
        Write-Host "⚠️  User already exists, proceeding with login..." -ForegroundColor Yellow
    } else {
        Write-Host "❌ Registration failed: $errorContent" -ForegroundColor Red
    }
}

# Test 3: Login to get token
Write-Host "`n3️⃣ Testing Authentication..." -ForegroundColor Blue
$loginBody = @{
    email = "testbooking@example.com"
    password = "TestPass123!"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-WebRequest -Uri "$baseUrl/api/auth/login" -Method POST -Headers $headers -Body $loginBody
    $loginResult = $loginResponse.Content | ConvertFrom-Json
    
    if ($loginResult.success) {
        $authToken = $loginResult.data.token
        $authHeaders = @{
            "Content-Type" = "application/json"
            "Authorization" = "Bearer $authToken"
        }
        Write-Host "✅ Authentication successful" -ForegroundColor Green
        Write-Host "   User: $($loginResult.data.user.first_name) $($loginResult.data.user.sur_name)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Authentication failed: $($loginResult.message)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Login request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 4: Get available courses for booking
Write-Host "`n4️⃣ Getting available courses..." -ForegroundColor Blue
try {
    $coursesResponse = Invoke-WebRequest -Uri "$baseUrl/api/courses?limit=5" -Method GET
    $coursesResult = $coursesResponse.Content | ConvertFrom-Json
    
    if ($coursesResult.success -and $coursesResult.data.courses.Count -gt 0) {
        $testCourse = $coursesResult.data.courses[0]
        Write-Host "✅ Found courses for testing" -ForegroundColor Green
        Write-Host "   Using course: $($testCourse.course_name) (ID: $($testCourse.id))" -ForegroundColor Gray
    } else {
        Write-Host "❌ No courses available for testing" -ForegroundColor Red
        Write-Host "   Response: $($coursesResult | ConvertTo-Json -Depth 2)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Failed to get courses: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 5: Get available events for the course
Write-Host "`n5️⃣ Getting available events..." -ForegroundColor Blue
try {
    $eventsResponse = Invoke-WebRequest -Uri "$baseUrl/api/courses/events/all?course_id=$($testCourse.id)&limit=5" -Method GET
    $eventsResult = $eventsResponse.Content | ConvertFrom-Json
    
    if ($eventsResult.success -and $eventsResult.data.events.Count -gt 0) {
        # Find an event in the future (handle null dates)
        $futureEvents = $eventsResult.data.events | Where-Object { 
            $_.event_date -ne $null -and 
            $_.event_date -ne "" -and 
            [DateTime]::Parse($_.event_date) -gt (Get-Date) 
        }
        
        if ($futureEvents.Count -gt 0) {
            $testEvent = $futureEvents[0]
            Write-Host "✅ Found future events for testing" -ForegroundColor Green
            Write-Host "   Using event: $($testEvent.event_date) at $($testEvent.location_name) (ID: $($testEvent.event_id))" -ForegroundColor Gray
        } else {
            Write-Host "⚠️  No future events available, using first available event for testing" -ForegroundColor Yellow
            $testEvent = $eventsResult.data.events[0]
            Write-Host "   Using event: $($testEvent.event_date) at $($testEvent.location_name) (ID: $($testEvent.event_id))" -ForegroundColor Gray
        }
    } else {
        Write-Host "❌ No events available for testing" -ForegroundColor Red
        Write-Host "   Response: $($eventsResult | ConvertTo-Json -Depth 2)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Failed to get events: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 6: Create a booking
Write-Host "`n6️⃣ Creating a booking..." -ForegroundColor Blue
$bookingBody = @{
    course_id = $testCourse.id
    course_event_id = $testEvent.event_id
    spaces = 1
    customer_notes = "Test booking from PowerShell script"
    emergency_contact_name = "Emergency Contact"
    emergency_contact_phone = "07987654321"
} | ConvertTo-Json

try {
    $bookingResponse = Invoke-WebRequest -Uri "$baseUrl/api/bookings" -Method POST -Headers $authHeaders -Body $bookingBody
    $bookingResult = $bookingResponse.Content | ConvertFrom-Json
    
    if ($bookingResult.success) {
        $testBookingId = $bookingResult.data.id
        Write-Host "✅ Booking created successfully" -ForegroundColor Green
        Write-Host "   Booking ID: $testBookingId" -ForegroundColor Gray
        Write-Host "   Status: $($bookingResult.data.status_text)" -ForegroundColor Gray
        Write-Host "   Total Amount: £$($bookingResult.data.total_amount)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Booking creation failed: $($bookingResult.message)" -ForegroundColor Red
        exit 1
    }
} catch {
    $errorContent = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "❌ Booking request failed: $($errorContent.message)" -ForegroundColor Red
    Write-Host "   Details: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 7: Get user bookings
Write-Host "`n7️⃣ Getting user bookings..." -ForegroundColor Blue
try {
    $userBookingsResponse = Invoke-WebRequest -Uri "$baseUrl/api/bookings" -Method GET -Headers $authHeaders
    $userBookingsResult = $userBookingsResponse.Content | ConvertFrom-Json
    
    if ($userBookingsResult.success) {
        Write-Host "✅ Retrieved user bookings successfully" -ForegroundColor Green
        Write-Host "   Total bookings: $($userBookingsResult.data.Count)" -ForegroundColor Gray
        Write-Host "   Page: $($userBookingsResult.pagination.page) of $($userBookingsResult.pagination.totalPages)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Failed to get user bookings: $($userBookingsResult.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ User bookings request failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 8: Get booking details
Write-Host "`n8️⃣ Getting booking details..." -ForegroundColor Blue
try {
    $bookingDetailsResponse = Invoke-WebRequest -Uri "$baseUrl/api/bookings/$testBookingId" -Method GET -Headers $authHeaders
    $bookingDetailsResult = $bookingDetailsResponse.Content | ConvertFrom-Json
    
    if ($bookingDetailsResult.success) {
        Write-Host "✅ Retrieved booking details successfully" -ForegroundColor Green
        Write-Host "   Course: $($bookingDetailsResult.data.course_name)" -ForegroundColor Gray
        Write-Host "   Date: $($bookingDetailsResult.data.event_date)" -ForegroundColor Gray
        Write-Host "   Location: $($bookingDetailsResult.data.location_name)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Failed to get booking details: $($bookingDetailsResult.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Booking details request failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 9: Update booking
Write-Host "`n9️⃣ Updating booking..." -ForegroundColor Blue
$updateBody = @{
    customer_notes = "Updated test booking notes"
    emergency_contact_name = "Updated Emergency Contact"
    emergency_contact_phone = "07555123456"
    special_requirements = "Updated special requirements"
} | ConvertTo-Json

try {
    $updateResponse = Invoke-WebRequest -Uri "$baseUrl/api/bookings/$testBookingId" -Method PUT -Headers $authHeaders -Body $updateBody
    $updateResult = $updateResponse.Content | ConvertFrom-Json
    
    if ($updateResult.success) {
        Write-Host "✅ Booking updated successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to update booking: $($updateResult.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Booking update request failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 10: Get booking statistics
Write-Host "`n🔟 Getting booking statistics..." -ForegroundColor Blue
try {
    $statsResponse = Invoke-WebRequest -Uri "$baseUrl/api/bookings/stats" -Method GET -Headers $authHeaders
    $statsResult = $statsResponse.Content | ConvertFrom-Json
    
    if ($statsResult.success) {
        Write-Host "✅ Retrieved booking statistics successfully" -ForegroundColor Green
        Write-Host "   Total bookings: $($statsResult.data.total_bookings)" -ForegroundColor Gray
        Write-Host "   Confirmed bookings: $($statsResult.data.confirmed_bookings)" -ForegroundColor Gray
        Write-Host "   Total spent: £$($statsResult.data.total_spent)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Failed to get booking statistics: $($statsResult.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Booking statistics request failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 11: Cancel booking
Write-Host "`n1️⃣1️⃣ Cancelling booking..." -ForegroundColor Blue
$cancelBody = @{
    cancellation_reason = "Test cancellation from PowerShell script"
} | ConvertTo-Json

try {
    $cancelResponse = Invoke-WebRequest -Uri "$baseUrl/api/bookings/$testBookingId/cancel" -Method POST -Headers $authHeaders -Body $cancelBody
    $cancelResult = $cancelResponse.Content | ConvertFrom-Json
    
    if ($cancelResult.success) {
        Write-Host "✅ Booking cancelled successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to cancel booking: $($cancelResult.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Booking cancellation request failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 Booking System Tests Completed!" -ForegroundColor Green
Write-Host "📊 Check the results above for any issues that need attention." -ForegroundColor Cyan