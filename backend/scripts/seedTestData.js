require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function main() {
  const allowSeed = process.env.ALLOW_TEST_SEED;
  if (allowSeed !== 'true') {
    console.error('Error: ALLOW_TEST_SEED must be exactly "true" to run this script.');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const testPhone = process.env.TEST_GUEST_PHONE;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided.');
    process.exit(1);
  }

  if (!testPhone) {
    console.error('Error: TEST_GUEST_PHONE must be provided.');
    process.exit(1);
  }

  // Refuse placeholders
  if (testPhone.includes('X') || testPhone.includes('your-phone-number')) {
    console.error('Error: TEST_GUEST_PHONE contains placeholders. Please provide a real testing number.');
    process.exit(1);
  }

  // Validate phone
  if (testPhone.startsWith('+')) {
    console.error('Error: TEST_GUEST_PHONE should not contain a leading plus sign.');
    process.exit(1);
  }
  
  if (!/^\d{8,15}$/.test(testPhone)) {
    console.error('Error: TEST_GUEST_PHONE must be 8-15 digits.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });

  // Check if tables exist
  const { error: tableCheckError } = await supabase.from('apartments').select('id').limit(1);
  
  if (tableCheckError && (tableCheckError.code === '42P01' || tableCheckError.message.includes('does not exist') || tableCheckError.message.includes('relation'))) {
    if (process.env.SUPABASE_DB_URL) {
      console.error('Error: Required database tables do not exist.');
      console.error('SUPABASE_DB_URL is configured. Please run the existing npm migration command first: npm run migrate');
      process.exit(1);
    } else {
      const sql1 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf-8');
      const sql2 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_conversation_ai_fields.sql'), 'utf-8');
      const outPath = path.join(__dirname, 'manual_migrations_for_supabase.sql');
      fs.writeFileSync(outPath, sql1 + '\n\n' + sql2);
      console.error('Error: Required database tables do not exist.');
      console.error(`Created ${outPath} containing the required migrations.`);
      console.error('Please run this SQL manually through the Supabase SQL Editor.');
      process.exit(1);
    }
  }

  // 1. Upsert a dashboard operator for Take Over / assignment testing.
  const { data: adminUser, error: adminError } = await supabase
    .from('admin_users')
    .upsert({
      email: 'test-operator@serendib.local',
      name: 'Test Support Operator',
      role: 'operator'
    }, { onConflict: 'email' })
    .select()
    .single();

  if (adminError) {
    console.error('Failed to upsert test dashboard operator:', adminError.message);
    process.exit(1);
  }

  // 2. Upsert Apartment
  const { data: apt, error: aptError } = await supabase
    .from('apartments')
    .upsert({
      code: 'TEST-APT-001',
      name: 'Test Ocean View Apartment',
      address: '100 Test Street, Colombo',
      map_link: 'https://maps.google.com/?q=Colombo',
      wifi_details: { ssid: 'Serendib_Test_WiFi', password: 'TestOnly123!' }
    }, { onConflict: 'code' })
    .select()
    .single();

  if (aptError) {
    console.error('Failed to upsert apartment:', aptError.message);
    process.exit(1);
  }

  // 3. Upsert Apartment Policy
  const { error: policyError } = await supabase
    .from('apartment_policies')
    .upsert({
      apartment_id: apt.id,
      checkin_time: '14:00',
      checkout_time: '11:00',
      parking_info: 'Free test parking is available in parking bay T01.',
      pet_policy: 'Pets require staff approval.',
      extra_guest_policy: 'Extra guests require staff approval.',
      early_checkin_fee: 25.00,
      late_checkout_fee: 25.00,
      max_occupancy: 4
    }, { onConflict: 'apartment_id' })
    .select()
    .single();

  if (policyError) {
    console.error('Failed to upsert apartment policy:', policyError.message);
    process.exit(1);
  }

  // 4. Upsert Guest
  const { data: guest, error: guestError } = await supabase
    .from('guests')
    .upsert({
      phone_number: testPhone,
      full_name: 'Nipun Test Guest',
      email: 'test-guest@example.com'
    }, { onConflict: 'phone_number' })
    .select()
    .single();

  if (guestError) {
    console.error('Failed to upsert guest:', guestError.message);
    process.exit(1);
  }

  // 5. Upsert Reservation
  const today = new Date();
  const checkinDate = today.toISOString().split('T')[0];
  const checkoutDateObj = new Date(today);
  checkoutDateObj.setDate(checkoutDateObj.getDate() + 2);
  const checkoutDate = checkoutDateObj.toISOString().split('T')[0];

  const { data: reservation, error: resError } = await supabase
    .from('reservations')
    .upsert({
      booking_id: 'TEST-BOOKING-001',
      booking_source: 'direct',
      apartment_id: apt.id,
      guest_id: guest.id,
      checkin_date: checkinDate,
      checkout_date: checkoutDate,
      status: 'confirmed',
      notes: 'Test reservation for WhatsApp Wi-Fi end-to-end testing'
    }, { onConflict: 'booking_id' })
    .select()
    .single();

  if (resError) {
    console.error('Failed to upsert reservation:', resError.message);
    process.exit(1);
  }

  // Verify records
  const { data: verifyApt } = await supabase.from('apartments').select('*').eq('id', apt.id).single();
  const { data: verifyPolicy } = await supabase.from('apartment_policies').select('*').eq('apartment_id', apt.id).single();
  const { data: verifyGuest } = await supabase.from('guests').select('*').eq('id', guest.id).single();
  const { data: verifyRes } = await supabase.from('reservations').select('*').eq('id', reservation.id).single();
  const { data: verifyAdmin } = await supabase.from('admin_users').select('*').eq('id', adminUser.id).single();

  if (!verifyApt || !verifyPolicy || !verifyGuest || !verifyRes || !verifyAdmin) {
    console.error('Error: Verification failed. Some records could not be retrieved.');
    process.exit(1);
  }

  if (verifyApt.wifi_details.ssid !== 'Serendib_Test_WiFi' || verifyApt.wifi_details.password !== 'TestOnly123!') {
    console.error('Error: Wi-Fi credentials missing or mismatched in database.');
    process.exit(1);
  }

  if (verifyGuest.phone_number !== testPhone) {
    console.error('Error: Guest phone number mismatch.');
    process.exit(1);
  }

  if (verifyRes.status !== 'confirmed') {
    console.error('Error: Reservation status is not confirmed.');
    process.exit(1);
  }

  const resCheckout = new Date(verifyRes.checkout_date);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (resCheckout < now) {
    console.error('Error: Checkout date is in the past.');
    process.exit(1);
  }

  if (verifyRes.apartment_id !== apt.id || verifyRes.guest_id !== guest.id || verifyPolicy.apartment_id !== apt.id) {
    console.error('Error: Foreign keys do not match.');
    process.exit(1);
  }

  console.log(`Apartment ID: ${apt.id}`);
  console.log(`Apartment Code: ${apt.code}`);
  console.log(`Dashboard Operator ID: ${adminUser.id}`);
  console.log(`Guest ID: ${guest.id}`);
  console.log(`Guest Phone (last 4 digits): ${testPhone.slice(-4)}`);
  console.log(`Reservation ID: ${reservation.id}`);
  console.log(`Booking ID: ${reservation.booking_id}`);
  console.log(`Check-in Date: ${reservation.checkin_date}`);
  console.log(`Check-out Date: ${reservation.checkout_date}`);
  console.log("Test data is ready for WhatsApp Wi-Fi flow testing.");
}

main().catch(err => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
