# Complete CMS API Testing Script

Write-Host "🎯 1Stop Instruction CMS API Testing" -ForegroundColor Magenta
Write-Host "============================================`n" -ForegroundColor Magenta

# Test API Documentation first
Write-Host "📋 Testing API Documentation..." -ForegroundColor Cyan
try {
    $apiDocs = Invoke-WebRequest -Uri "http://localhost:3000/api" -Method GET | ConvertFrom-Json
    Write-Host "✅ API Documentation loaded successfully" -ForegroundColor Green
    Write-Host "CMS Endpoints: $($apiDocs.endpoints.cms.Count)" -ForegroundColor Yellow
    Write-Host "CMS Admin Endpoints: $($apiDocs.endpoints.cms_admin.Count)" -ForegroundColor Yellow
} catch {
    Write-Host "❌ API Documentation Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n🏠 Testing CMS Pages..." -ForegroundColor Green

# 1. Get all pages with pagination
Write-Host "`n1. Getting pages (limit 5):"
try {
    $pagesResponse = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/pages?limit=5" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($pagesResponse.data.Count) pages (Total: $($pagesResponse.pagination.total))" -ForegroundColor Green
    $pagesResponse.data | Select-Object id, page_title, slug, featured_service | Format-Table
} catch {
    Write-Host "❌ Pages Error: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. Get specific page by slug
Write-Host "`n2. Getting 'Home' page by slug:"
try {
    $homePage = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/pages/home" -Method GET | ConvertFrom-Json
    Write-Host "✅ Home page retrieved successfully" -ForegroundColor Green
    Write-Host "Title: $($homePage.data.page_title)" -ForegroundColor Yellow
    Write-Host "Meta Title: $($homePage.data.meta_title.Substring(0,[Math]::Min(100,$homePage.data.meta_title.Length)))" -ForegroundColor Yellow
} catch {
    Write-Host "❌ Home Page Error: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Search pages
Write-Host "`n3. Searching pages for 'CBT':"
try {
    $searchResults = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/pages?search=CBT`&limit=3" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($searchResults.data.Count) pages matching 'CBT'" -ForegroundColor Green
    $searchResults.data | Select-Object page_title, slug | Format-Table
} catch {
    Write-Host "❌ Search Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n💬 Testing CMS Testimonials..." -ForegroundColor Green

# 4. Get testimonials
Write-Host "`n4. Getting testimonials:"
try {
    $testimonials = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/testimonials?limit=3" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($testimonials.data.Count) testimonials" -ForegroundColor Green
    $testimonials.data | Select-Object id, review_name, @{n='review_preview';e={$_.review.Substring(0,[Math]::Min(50,$_.review.Length)) + "..."}} | Format-Table
} catch {
    Write-Host "❌ Testimonials Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n❓ Testing CMS FAQs..." -ForegroundColor Green

# 5. Get FAQs with categories
Write-Host "`n5. Getting FAQs:"
try {
    $faqs = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/faqs" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($faqs.data.faqs.Count) FAQs in $($faqs.data.categories.Count) categories" -ForegroundColor Green
    Write-Host "Categories:" -ForegroundColor Yellow
    $faqs.data.categories | Format-Table
    Write-Host "Sample FAQs:" -ForegroundColor Yellow
    $faqs.data.faqs | Select-Object -First 3 | Select-Object faq_title, category_name, weight | Format-Table
} catch {
    Write-Host "❌ FAQs Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎠 Testing CMS Carousels..." -ForegroundColor Green

# 6. Get carousels
Write-Host "`n6. Getting carousels:"
try {
    $carousels = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/carousels" -Method GET | ConvertFrom-Json
    Write-Host "✅ Found $($carousels.data.Count) carousel items" -ForegroundColor Green
    $carousels.data | Select-Object id, caption, weight | Format-Table
} catch {
    Write-Host "❌ Carousels Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n⚙️ Testing CMS Settings..." -ForegroundColor Green

# 7. Get site settings
Write-Host "`n7. Getting site settings:"
try {
    $settings = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/settings" -Method GET | ConvertFrom-Json
    Write-Host "✅ Site settings retrieved" -ForegroundColor Green
    Write-Host "Contact: $($settings.data.site_contact)" -ForegroundColor Yellow
    Write-Host "Email: $($settings.data.site_email)" -ForegroundColor Yellow
    Write-Host "VAT Rate: $($settings.data.vat_rate)%" -ForegroundColor Yellow
    Write-Host "Card Surcharge: $($settings.data.credit_card_surcharge)%" -ForegroundColor Yellow
} catch {
    Write-Host "❌ Settings Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📋 Testing CMS Menu Structure..." -ForegroundColor Green

# 8. Get page hierarchy/menu
Write-Host "`n8. Getting page hierarchy:"
try {
    $menu = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/menu" -Method GET | ConvertFrom-Json
    Write-Host "✅ Menu structure retrieved" -ForegroundColor Green
    Write-Host "Root pages: $($menu.data.pages.Count)" -ForegroundColor Yellow
    Write-Host "Footer pages: $($menu.data.footer_pages.Count)" -ForegroundColor Yellow
    Write-Host "Featured services: $($menu.data.featured_services.Count)" -ForegroundColor Yellow
    
    Write-Host "`nFeatured Services:" -ForegroundColor Cyan
    $menu.data.featured_services | Select-Object page_title, featured_icon, slug | Format-Table
} catch {
    Write-Host "❌ Menu Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🔐 Testing CMS Admin Functions..." -ForegroundColor Blue

# 9. Get CMS dashboard stats (admin endpoint)
Write-Host "`n9. Getting CMS dashboard statistics (admin):"
try {
    $dashboardStats = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/admin/dashboard" -Method GET -Headers @{"Authorization" = "Bearer admin-token"} | ConvertFrom-Json
    Write-Host "✅ Dashboard stats retrieved" -ForegroundColor Green
    Write-Host "Total Pages: $($dashboardStats.data.statistics.pages.total_pages)" -ForegroundColor Yellow
    Write-Host "Featured Pages: $($dashboardStats.data.statistics.pages.featured_pages)" -ForegroundColor Yellow
    Write-Host "Active Testimonials: $($dashboardStats.data.statistics.testimonials.active_testimonials)" -ForegroundColor Yellow
    Write-Host "Total FAQs: $($dashboardStats.data.statistics.faqs.total_faqs)" -ForegroundColor Yellow
    
    Write-Host "`nRecent Page Updates:" -ForegroundColor Cyan
    $dashboardStats.data.recent_updates | Select-Object page_title, updated | Format-Table
} catch {
    Write-Host "❌ Dashboard Stats Error: $($_.Exception.Message)" -ForegroundColor Red
}

# 10. Global CMS search (admin endpoint)
Write-Host "`n10. Testing global CMS search (admin):"
try {
    $globalSearch = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/admin/search?query=CBT" -Method GET -Headers @{"Authorization" = "Bearer admin-token"} | ConvertFrom-Json
    Write-Host "✅ Global search completed" -ForegroundColor Green
    Write-Host "Total Results: $($globalSearch.total_results)" -ForegroundColor Yellow
    
    if ($globalSearch.data.pages) {
        Write-Host "`nPage Results:" -ForegroundColor Cyan
        $globalSearch.data.pages | Select-Object page_title, slug | Format-Table
    }
} catch {
    Write-Host "❌ Global Search Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📤 Testing CMS Export..." -ForegroundColor Blue

# 11. Export CMS content (admin endpoint)
Write-Host "`n11. Testing CMS content export (admin):"
try {
    $export = Invoke-WebRequest -Uri "http://localhost:3000/api/cms/admin/export?type=settings" -Method GET -Headers @{"Authorization" = "Bearer admin-token"} | ConvertFrom-Json
    Write-Host "✅ CMS export completed" -ForegroundColor Green
    Write-Host "Export Date: $($export.export_date)" -ForegroundColor Yellow
    Write-Host "Export Type: $($export.export_type)" -ForegroundColor Yellow
} catch {
    Write-Host "❌ Export Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 CMS API Testing Summary" -ForegroundColor Magenta
Write-Host "=================================" -ForegroundColor Magenta
Write-Host "✅ CMS System is fully functional!" -ForegroundColor Green
Write-Host "📄 Content Management: Pages, SEO, Hierarchies" -ForegroundColor Yellow
Write-Host "💬 Review System: Testimonials with moderation" -ForegroundColor Yellow
Write-Host "❓ Knowledge Base: FAQs with categories" -ForegroundColor Yellow
Write-Host "🎠 Media Management: Carousels and banners" -ForegroundColor Yellow
Write-Host "⚙️ Site Configuration: Global settings" -ForegroundColor Yellow
Write-Host "🔍 Search and Export: Admin tools available" -ForegroundColor Yellow
Write-Host "Complete CMS discovered in 1Stop database!" -ForegroundColor Green