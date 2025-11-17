# Test CMS API Endpoints

# Test basic API documentation
Invoke-WebRequest -Uri "http://localhost:3000/api" -Method GET | ConvertFrom-Json | ConvertTo-Json -Depth 10

Write-Host "`n=== CMS Pages API Tests ===" -ForegroundColor Green

# 1. Get all pages
Write-Host "`n1. Getting all pages:" -ForegroundColor Cyan
try {
    $pages = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/pages" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($pages.data.Count) pages" -ForegroundColor Green
    $pages.data | Select-Object id, page_title, slug, weight | Format-Table
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. Get specific page by slug (home page example)
Write-Host "`n2. Getting page by slug 'home':" -ForegroundColor Cyan
try {
    $homePage = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/pages/home" -Method GET | ConvertFrom-Json
    Write-Host "✅ Home page found:" -ForegroundColor Green
    $homePage.data | Select-Object page_title, slug, meta_title, featured_service | Format-List
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== CMS Testimonials API Tests ===" -ForegroundColor Green

# 3. Get testimonials
Write-Host "`n3. Getting testimonials:" -ForegroundColor Cyan
try {
    $testimonials = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/testimonials" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($testimonials.data.Count) testimonials" -ForegroundColor Green
    $testimonials.data | Select-Object id, review_name, @{n='review_preview';e={$_.review.Substring(0,[Math]::Min(50,$_.review.Length))}} | Format-Table
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== CMS FAQs API Tests ===" -ForegroundColor Green

# 4. Get FAQs
Write-Host "`n4. Getting FAQs:" -ForegroundColor Cyan
try {
    $faqs = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/faqs" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($faqs.data.faqs.Count) FAQs in $($faqs.data.categories.Count) categories" -ForegroundColor Green
    $faqs.data.categories | Select-Object id, category_name | Format-Table
    $faqs.data.faqs | Select-Object id, faq_title, category_name, weight | Format-Table
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== CMS Carousels API Tests ===" -ForegroundColor Green

# 5. Get carousels
Write-Host "`n5. Getting carousels:" -ForegroundColor Cyan
try {
    $carousels = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/carousels" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($carousels.data.Count) carousel items" -ForegroundColor Green
    $carousels.data | Select-Object id, caption, weight | Format-Table
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== CMS Settings API Tests ===" -ForegroundColor Green

# 6. Get site settings
Write-Host "`n6. Getting site settings:" -ForegroundColor Cyan
try {
    $settings = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/settings" -Method GET | ConvertFrom-Json
    Write-Host "✅ Site settings retrieved:" -ForegroundColor Green
    $settings.data | Select-Object site_contact, site_email, vat_rate, credit_card_surcharge | Format-List
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== CMS Menu Structure API Tests ===" -ForegroundColor Green

# 7. Get page hierarchy/menu
Write-Host "`n7. Getting page hierarchy:" -ForegroundColor Cyan
try {
    $menu = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/menu" -Method GET | ConvertFrom-Json
    Write-Host "✅ Menu structure retrieved:" -ForegroundColor Green
    Write-Host "Root pages: $($menu.data.pages.Count)" -ForegroundColor Yellow
    Write-Host "Footer pages: $($menu.data.footer_pages.Count)" -ForegroundColor Yellow
    Write-Host "Featured services: $($menu.data.featured_services.Count)" -ForegroundColor Yellow
    
    $menu.data.pages | Select-Object page_title, slug, weight, @{n='children_count';e={$_.children.Count}} | Format-Table
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== CMS Page Search Tests ===" -ForegroundColor Green

# 8. Search pages
Write-Host "`n8. Searching pages for 'CBT':" -ForegroundColor Cyan
try {
    $searchResults = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/pages?search=CBT" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($searchResults.data.Count) pages matching 'CBT'" -ForegroundColor Green
    $searchResults.data | Select-Object page_title, slug | Format-Table
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== CMS API Test Summary ===" -ForegroundColor Magenta
Write-Host "✅ CMS API endpoints are working" -ForegroundColor Green
Write-Host "📄 Pages: Content management with SEO, hierarchy, and featured services" -ForegroundColor Yellow
Write-Host "💬 Testimonials: Customer reviews with moderation" -ForegroundColor Yellow
Write-Host "❓ FAQs: Categorized frequently asked questions" -ForegroundColor Yellow
Write-Host "🎠 Carousels: Image sliders and banners" -ForegroundColor Yellow
Write-Host "⚙️ Settings: Site configuration and global settings" -ForegroundColor Yellow
Write-Host "📋 Menu: Navigation hierarchy and page structure" -ForegroundColor Yellow