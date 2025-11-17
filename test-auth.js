// test-auth.js - Simple authentication test script
const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

async function testAuthentication() {
  console.log('🧪 Testing 1Stop Instruction API Authentication\n');

  try {
    // Test 1: API Documentation
    console.log('1️⃣  Testing API Documentation...');
    const apiDoc = await axios.get(`${BASE_URL.replace('/api', '')}/api`);
    console.log('✅ API Documentation loaded successfully\n');

    // Test 2: User Registration
    console.log('2️⃣  Testing User Registration...');
    const registerData = {
      first_name: 'Test',
      sur_name: 'User',
      email: `test.${Date.now()}@example.com`,
      password: 'TestPass123',
      contact1: '07123456789',
      add1: '123 Test Street',
      postcode: 'SW1A 1AA'
    };

    const registerResponse = await axios.post(`${BASE_URL}/auth/register`, registerData);
    console.log('✅ User registered successfully');
    console.log(`   User ID: ${registerResponse.data.data.user.id}`);
    console.log(`   Email: ${registerResponse.data.data.user.email}`);
    console.log(`   Token: ${registerResponse.data.data.token.substring(0, 20)}...\n`);

    // Test 3: User Login
    console.log('3️⃣  Testing User Login...');
    const loginData = {
      email: registerData.email,
      password: registerData.password
    };

    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, loginData);
    const token = loginResponse.data.data.token;
    console.log('✅ Login successful');
    console.log(`   Token: ${token.substring(0, 20)}...\n`);

    // Test 4: Protected Route Access
    console.log('4️⃣  Testing Protected Route Access...');
    const headers = { Authorization: `Bearer ${token}` };
    
    const profileResponse = await axios.get(`${BASE_URL}/auth/profile`, { headers });
    console.log('✅ Profile access successful');
    console.log(`   Name: ${profileResponse.data.data.first_name} ${profileResponse.data.data.sur_name}`);
    console.log(`   Email: ${profileResponse.data.data.email}\n`);

    // Test 5: Token Verification
    console.log('5️⃣  Testing Token Verification...');
    const verifyResponse = await axios.get(`${BASE_URL}/auth/verify`, { headers });
    console.log('✅ Token verification successful');
    console.log(`   User ID: ${verifyResponse.data.user.id}`);
    console.log(`   Registration Type: ${verifyResponse.data.user.reg_type}\n`);

    // Test 6: Profile Update
    console.log('6️⃣  Testing Profile Update...');
    const updateData = {
      first_name: 'Updated',
      add2: 'Updated Address Line 2'
    };

    const updateResponse = await axios.put(`${BASE_URL}/auth/profile`, updateData, { headers });
    console.log('✅ Profile update successful');
    console.log(`   Updated Name: ${updateResponse.data.data.first_name} ${updateResponse.data.data.sur_name}`);
    console.log(`   Updated Address 2: ${updateResponse.data.data.add2 || 'N/A'}\n`);

    // Test 7: Invalid Token Access (should fail)
    console.log('7️⃣  Testing Invalid Token (Expected to Fail)...');
    try {
      const invalidHeaders = { Authorization: 'Bearer invalid-token' };
      await axios.get(`${BASE_URL}/auth/profile`, { headers: invalidHeaders });
      console.log('❌ Security issue: Invalid token was accepted!');
    } catch (error) {
      console.log('✅ Security working: Invalid token rejected correctly\n');
    }

    console.log('🎉 All authentication tests passed successfully!');
    console.log('\n📋 Available Endpoints:');
    console.log('   POST /api/auth/register - Register new user');
    console.log('   POST /api/auth/login - Login user');
    console.log('   GET /api/auth/profile - Get user profile (requires token)');
    console.log('   PUT /api/auth/profile - Update profile (requires token)');
    console.log('   POST /api/auth/change-password - Change password (requires token)');
    console.log('   GET /api/auth/verify - Verify token (requires token)');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run if called directly
if (require.main === module) {
  testAuthentication();
}

module.exports = testAuthentication;