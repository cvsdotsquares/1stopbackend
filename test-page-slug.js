// Test script for page content by slug API
const axios = require('axios');

const API_BASE = 'http://localhost:5000/api/cms';

async function testPageBySlug() {
  console.log('🧪 Testing Page Content by Slug API\n');

  try {
    // Test cases with different slugs
    const testSlugs = [
      'about-us',
      'motorcycle-training',
      'contact',
      'cbt-training',
      'services'
    ];

    for (const slug of testSlugs) {
      try {
        console.log(`📄 Testing slug: "${slug}"`);
        
        const response = await axios.get(`${API_BASE}/page/slug/${slug}`);
        
        if (response.data.success) {
          const page = response.data.data;
          console.log(`✅ Success: ${page.page_title}`);
          console.log(`   Slug: ${page.slug}`);
          console.log(`   Content Length: ${page.page_content?.length || 0} characters`);
          console.log(`   SEO Title: ${page.meta.title}`);
          console.log(`   Has Children: ${page.childPages?.length || 0} pages`);
          console.log(`   Related Pages: ${page.relatedPages?.length || 0} pages`);
          console.log(`   Navigation: ${page.navigation?.prev ? 'Has Prev' : 'No Prev'} | ${page.navigation?.next ? 'Has Next' : 'No Next'}`);
          
          if (page.breadcrumbs) {
            console.log(`   Breadcrumbs: ${page.breadcrumbs.map(b => b.title).join(' > ')}`);
          }
        } else {
          console.log(`❌ Failed: ${response.data.message}`);
        }
        
      } catch (error) {
        if (error.response?.status === 404) {
          console.log(`❌ Page not found: "${slug}"`);
        } else {
          console.log(`❌ Error testing "${slug}":`, error.message);
        }
      }
      
      console.log(''); // Empty line for readability
    }

    // Test enhanced page endpoint with existing identifier
    console.log('📄 Testing enhanced page endpoint with ID/slug:');
    try {
      const response = await axios.get(`${API_BASE}/pages/about-us`);
      if (response.data.success) {
        const page = response.data.data;
        console.log(`✅ Enhanced endpoint working: ${page.page_title}`);
        console.log(`   Has breadcrumbs: ${!!page.breadcrumbs}`);
        console.log(`   Has SEO data: ${!!page.seo}`);
        console.log(`   Child pages: ${page.childPages?.length || 0}`);
      }
    } catch (error) {
      console.log('❌ Enhanced endpoint error:', error.response?.data?.message || error.message);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// API Usage Examples
function showAPIUsageExamples() {
  console.log('\n📚 API Usage Examples:\n');

  console.log('1. Get page by slug (new dedicated endpoint):');
  console.log('   GET /api/cms/page/slug/about-us');
  console.log('   Returns: Complete page content + SEO + related pages + navigation\n');

  console.log('2. Get page by ID or slug (enhanced existing endpoint):');
  console.log('   GET /api/cms/pages/123 (by ID)');
  console.log('   GET /api/cms/pages/about-us (by slug)');
  console.log('   Returns: Complete page content + children + parent + breadcrumbs\n');

  console.log('3. Frontend usage example:');
  console.log(`
  // Next.js page component
  export async function getStaticProps({ params }) {
    const response = await fetch(\`\${API_BASE}/page/slug/\${params.slug}\`);
    const { data: page } = await response.json();
    
    return {
      props: { page },
      revalidate: 3600 // Revalidate every hour
    };
  }
  `);

  console.log('4. Response structure:');
  console.log(`
  {
    "success": true,
    "data": {
      "id": 1,
      "page_title": "About Us",
      "slug": "about-us",
      "page_content": "Full HTML content...",
      "meta": {
        "title": "About Us - 1Stop Training",
        "description": "Learn about our training...",
        "keywords": "motorcycle training, driving lessons",
        "canonical": "/about-us",
        "ogTitle": "About Us - 1Stop Training",
        "ogDescription": "Learn about our training...",
        "ogImage": "/images/about-banner.jpg"
      },
      "relatedPages": [...],
      "navigation": {
        "prev": { "title": "Home", "slug": "home" },
        "next": { "title": "Services", "slug": "services" }
      }
    }
  }
  `);
}

// Run tests if file is executed directly
if (require.main === module) {
  testPageBySlug().then(() => {
    showAPIUsageExamples();
  });
}

module.exports = { testPageBySlug };