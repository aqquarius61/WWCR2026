import { initialCats } from './cats-data.js';

// ==========================================
// 0. Supabase 클라이언트 초기화
// ==========================================
const SUPABASE_URL = 'https://mawaaenlnghpjgmkiyyo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hd2FhZW5sbmdocGpnbWtpeXlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTI0MzgsImV4cCI6MjA5ODgyODQzOH0.Xu-Ah9KYKKPjPtr6NhkYnfZehrU-VVCiU9b-R0mwcbU';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 1. 상태 및 상수 관리
// ==========================================
let cats = [];
let currentUser = null;
let isMuted = false;
let audioCtx = null;

// 매크로 감지용 글로벌 변수
const PET_RATE_LIMIT_MS = 250; // 쓰다듬기 입력간 최소 간격 (Throttling)
let lastPetTimes = []; // 최근 쓰다듬기 타임스탬프 리스트 (속도 분석용)
const MACRO_CHECK_WINDOW = 10; // 분석할 최근 입력 개수
const MACRO_THRESHOLD_SPEED = 8; // 초당 8회 초과 입력 시 차단

// 카테고리 필터 및 실시간 검색용 상태 변수
let activeBreed = 'all';
let searchQuery = '';

// ==========================================
// 2. 초기 데이터 로드 및 Supabase 연동
// ==========================================
async function initApp() {
  // 사용자 세션 로드
  const storedUser = localStorage.getItem('purr_user');
  if (storedUser) {
    currentUser = JSON.parse(storedUser);
  }

  // 음소거 상태 로드
  const storedMute = localStorage.getItem('purr_mute');
  if (storedMute) {
    isMuted = JSON.parse(storedMute);
    updateSoundIcon();
  }

  // 1. 실시간 DB 변경사항 감지 채널 오픈
  setupRealtimeSubscription();

  // 2. 서버에서 고양이 목록 조회 및 렌더링
  await fetchCats();

  updateAuthUI();
  setupFilterEvents(); // 필터 및 검색 이벤트 바인딩 추가
  
  // Lucide 아이콘 렌더링
  lucide.createIcons();
}

// 2-1. Supabase 고양이 데이터 조회
async function fetchCats() {
  try {
    const { data, error } = await supabase
      .from('cats')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // 만약 데이터베이스가 완전히 비어있다면 초기 Seed 데이터 등록(마이그레이션) 실행
    if (!data || data.length === 0) {
      await seedDefaultCats();
    } else {
      cats = data;
      renderCatGrid();
      renderLeaderboard();
    }
  } catch (err) {
    console.error('고양이 데이터를 가져오는데 실패했습니다:', err);
    showToast('서버 데이터 로드 실패 😿', 'error');
  }
}

// 2-2. 최초 마이그레이션 (DB가 비어있을 때 로컬 씨드 데이터 삽입)
async function seedDefaultCats() {
  const seedData = initialCats.map(cat => ({
    id: cat.id,
    name: cat.name,
    breed: cat.breed || '기타', // 묘종 매핑 추가
    image_url: cat.image, // mapping
    pet_count: cat.petCount, // mapping
    owner: cat.owner
  }));

  const { data, error } = await supabase
    .from('cats')
    .insert(seedData)
    .select();

  if (error) {
    console.error('Seed 데이터 구축 실패:', error);
    showToast('기본 데이터 초기화 실패', 'error');
  } else {
    cats = data;
    renderCatGrid();
    renderLeaderboard();
    showToast('기본 고양이 도감이 원격 데이터베이스에 연동되었습니다!', 'success');
  }
}

// 2-3. Supabase Realtime 채널 실시간 수신 구독
function setupRealtimeSubscription() {
  supabase
    .channel('cats-realtime-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cats' }, (payload) => {
      const eventType = payload.eventType;
      const newRow = payload.new;
      const oldRow = payload.old;

      if (eventType === 'INSERT') {
        // 이미 들어와있는 고양이가 아닐 때에만 앞에 삽입
        if (!cats.some(c => c.id === newRow.id)) {
          cats.unshift(newRow);
          renderCatGrid();
          renderLeaderboard();
        }
      } else if (eventType === 'UPDATE') {
        const cat = cats.find(c => c.id === newRow.id);
        if (cat) {
          cat.pet_count = newRow.pet_count;
          
          // 숫자가 든 노드만 빠른 직접 업데이트 (성능 극대화)
          const countEl = document.getElementById(`count-${newRow.id}`);
          if (countEl) {
            countEl.innerText = newRow.pet_count.toLocaleString();
          }
          
          // 랭킹 판 업데이트
          renderLeaderboard();
        }
      } else if (eventType === 'DELETE') {
        cats = cats.filter(c => c.id === oldRow.id);
        renderCatGrid();
        renderLeaderboard();
      }
    })
    .subscribe();
}

// ==========================================
// 3. Web Audio API 고양이 소리 신디사이저
// ==========================================
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// 3-1. 귀여운 "야옹~" (Meow) 소리 합성
function playMeowSound() {
  if (isMuted) return;
  initAudio();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  
  // 메인 오실레이터 (부드러운 삼각파)
  const osc = audioCtx.createOscillator();
  osc.type = 'triangle';
  
  // 고양이 비음 묘사를 위한 서브 오실레이터 (사인파)
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';

  const gainNode = audioCtx.createGain();
  
  // 야옹 소리의 피치 벤딩 (시간에 따른 주파수 상승 및 하강)
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(680, now + 0.12);
  osc.frequency.exponentialRampToValueAtTime(450, now + 0.35);

  osc2.frequency.setValueAtTime(640, now);
  osc2.frequency.exponentialRampToValueAtTime(1360, now + 0.12);
  osc2.frequency.exponentialRampToValueAtTime(900, now + 0.35);

  // 음량 엔벨로프 설정 (부드러운 어택, 페이드아웃)
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.2, now + 0.05); // 어택
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4); // 릴리즈

  // 연결
  osc.connect(gainNode);
  osc2.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  osc.start(now);
  osc2.start(now);
  osc.stop(now + 0.45);
  osc2.stop(now + 0.45);
}

// 3-2. "골골골골" (Purr) 소리 합성
function playPurrSound() {
  if (isMuted) return;
  initAudio();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  const duration = 0.5;

  // 아주 낮은 기본음 주파수 (75Hz)
  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(75, now);

  // 고주파 차단을 위한 필터 (로우패스 필터로 부드럽게)
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(150, now);

  // 진폭 변조를 위한 Gain Node
  const gainNode = audioCtx.createGain();
  
  // 골골거리는 리듬(LFO 효과) 생성
  gainNode.gain.setValueAtTime(0.01, now);
  for (let t = 0; t < duration; t += 0.08) {
    gainNode.gain.linearRampToValueAtTime(0.12, now + t + 0.02);
    gainNode.gain.linearRampToValueAtTime(0.01, now + t + 0.06);
  }
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + duration);
}

// ==========================================
// 4. UI 렌더링 (고양이 피드 & 랭킹)
// ==========================================

// 4-1. 다이내믹 고양이 그리드 렌더링 (필터 및 실시간 검색 적용)
function renderCatGrid() {
  const grid = document.getElementById('cat-grid');
  grid.innerHTML = '';

  // 활성 묘종 필터 및 텍스트 검색 동시 적용
  const filteredCats = cats.filter(cat => {
    // 1. 카테고리 칩 필터링
    let breedMatch = false;
    if (activeBreed === 'all') {
      breedMatch = true;
    } else if (activeBreed === '기타') {
      // 지정된 주요 묘종이 아니면 기타로 분류
      const mainBreeds = ['코리안 숏헤어', '러시안 블루', '샴', '페르시안', '브리티시 숏헤어'];
      breedMatch = !cat.breed || cat.breed.includes('기타') || !mainBreeds.some(mb => cat.breed.includes(mb));
    } else {
      // 주요 묘종 부분 일치 감지 (예: '코리안 숏헤어 (치즈 태비)' -> '코리안 숏헤어' 매칭)
      breedMatch = cat.breed && cat.breed.includes(activeBreed);
    }

    // 2. 실시간 텍스트 검색 (이름 또는 묘종 대상)
    const q = searchQuery.toLowerCase().trim();
    const nameMatch = cat.name.toLowerCase().includes(q);
    const breedSearchMatch = cat.breed && cat.breed.toLowerCase().includes(q);
    const textMatch = q === '' || nameMatch || breedSearchMatch;

    return breedMatch && textMatch;
  });

  filteredCats.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.dataset.id = cat.id;

    card.innerHTML = `
      <div class="pet-zone" data-id="${cat.id}">
        <img src="${cat.image_url}" class="cat-image" alt="${cat.name}" draggable="false">
        <!-- 이름 플로팅 뱃지 (왼쪽 아래) -->
        <div class="cat-name-badge">
          <span class="cat-card-name">${escapeHTML(cat.name)}</span>
        </div>
        <!-- 하트 수 플로팅 뱃지 (오른쪽 아래) -->
        <div class="pet-badge">
          <i data-lucide="heart" class="heart-icon"></i>
          <span class="pet-stat-count" id="count-${cat.id}">${cat.pet_count.toLocaleString()}</span>
        </div>
      </div>
    `;

    grid.appendChild(card);
    setupPetInteraction(card.querySelector('.pet-zone'), cat.id);
  });

  // 동적 생성된 카드들의 아이콘 활성화
  lucide.createIcons();
}

// 4-2. 실시간 랭킹 보드 렌더링 (Podium + List)
function renderLeaderboard() {
  // 복사본을 만들어 점수 내림차순 정렬
  const sorted = [...cats].sort((a, b) => b.pet_count - a.pet_count);
  
  // 1, 2, 3위 포디움 렌더링
  const podiumContainer = document.getElementById('ranking-podium');
  podiumContainer.innerHTML = '';

  const top3 = sorted.slice(0, 3);
  
  // 포디움 템플릿 생성용 헬퍼
  const createPodiumSpot = (cat, rankName, trophyIcon, rankNum) => {
    if (!cat) return `<div class="podium-spot spot-${rankName}"></div>`;
    return `
      <div class="podium-spot spot-${rankName}" dataset-id="${cat.id}">
        <div class="podium-avatar">
          <div class="podium-crown">${trophyIcon}</div>
          <img src="${cat.image_url}" alt="${cat.name}">
        </div>
        <div class="podium-step">
          <span>${rankNum}</span>
        </div>
        <span class="podium-name">${escapeHTML(cat.name)}</span>
        <span class="podium-score">${cat.pet_count.toLocaleString()} P</span>
      </div>
    `;
  };

  podiumContainer.innerHTML += createPodiumSpot(top3[0], '1st', '👑', '1');
  podiumContainer.innerHTML += createPodiumSpot(top3[1], '2nd', '🥈', '2');
  podiumContainer.innerHTML += createPodiumSpot(top3[2], '3rd', '🥉', '3');

  // 4위 이하 리스트 렌더링
  const listContainer = document.getElementById('ranking-list');
  listContainer.innerHTML = '';

  const runnersUp = sorted.slice(3);
  runnersUp.forEach((cat, index) => {
    const rank = index + 4;
    const item = document.createElement('div');
    item.className = 'ranking-item';
    item.dataset.id = cat.id;
    item.innerHTML = `
      <span class="ranking-rank">${rank}</span>
      <div class="ranking-avatar">
        <img src="${cat.image_url}" alt="${cat.name}">
      </div>
      <div class="ranking-info">
        <div class="ranking-name">${escapeHTML(cat.name)}</div>
      </div>
      <div class="ranking-score">${cat.pet_count.toLocaleString()} P</div>
    `;
    listContainer.appendChild(item);
  });
}

// ==========================================
// 5. 쓰다듬기(Petting) 물리 엔진 & 매크로 탐지
// ==========================================
function setupPetInteraction(petZone, catId) {
  let lastPetTriggerTime = 0;
  let startX = 0;
  let startY = 0;
  let isDragGesture = false;

  // 이미지 자체의 브라우저 기본 드래그 앤 드롭 기능 차단
  petZone.addEventListener('dragstart', (e) => e.preventDefault());

  // 터치/마우스 시작 좌표 기록
  petZone.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDragGesture = false;
  });

  // 터치/마우스 이동 거리 판정 (이동 거리가 10px 이상이면 드래그로 판정)
  petZone.addEventListener('pointerup', (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= 10) {
      isDragGesture = true;
    }
  });

  // 터치/클릭했을 때 즉각 쓰다듬기 실행 (1회 클릭당 1 하트)
  petZone.addEventListener('click', (e) => {
    // 0. 만약 모바일에서 스크롤(드래그) 동작이었다면 쓰다듬기 카운트 무시
    if (isDragGesture) {
      isDragGesture = false;
      return;
    }

    // 로그인 체크
    if (!currentUser) {
      e.preventDefault();
      e.stopPropagation();
      showToast('로그인이 필요한 기능입니다!', 'warning');
      openModal(document.getElementById('auth-modal'));
      return;
    }

    const now = Date.now();
    
    // 1. Throttling 매크로 검증 (클릭 간격 제한: 0.15초 이내 광클 방지)
    if (now - lastPetTriggerTime < 150) {
      return;
    }

    // 2. 기계식 오토 마우스 패턴 분석 (간격 일정성 분석)
    if (detectMacroPattern(now)) {
      triggerMacroBlock();
      return;
    }

    // 쓰다듬기 실행 (클릭 좌표 전달)
    triggerPet(catId, e.clientX, e.clientY);
    lastPetTriggerTime = now;
  });
}

// 5-1. 매크로 입력 차단 패턴 분석기
function detectMacroPattern(now) {
  lastPetTimes.push(now);
  
  if (lastPetTimes.length > MACRO_CHECK_WINDOW) {
    lastPetTimes.shift();
  }

  if (lastPetTimes.length === MACRO_CHECK_WINDOW) {
    const firstTime = lastPetTimes[0];
    const lastTime = lastPetTimes[lastPetTimes.length - 1];
    const durationSec = (lastTime - firstTime) / 1000;
    const speed = lastPetTimes.length / durationSec;
    
    if (speed > MACRO_THRESHOLD_SPEED) {
      return true; // 너무 빠르면 차단
    }

    let intervals = [];
    for (let i = 1; i < lastPetTimes.length; i++) {
      intervals.push(lastPetTimes[i] - lastPetTimes[i - 1]);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;

    if (Math.sqrt(variance) < 3.5) {
      return true; // 기계적 입력 차단
    }
  }
  return false;
}

function triggerMacroBlock() {
  const warning = document.getElementById('macro-warning');
  warning.classList.remove('hidden');
  
  if (!isMuted) {
    initAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  }
}

// 5-3. 쓰다듬기 실행 (Supabase DB 연동)
async function triggerPet(catId, clientX, clientY) {
  const cat = cats.find(c => c.id === catId);
  if (!cat) return;

  const nextCount = cat.pet_count + 1;
  
  // 1. 선반응 UI 업데이트 (Optimistic UI)
  cat.pet_count = nextCount;
  const countEl = document.getElementById(`count-${catId}`);
  if (countEl) {
    countEl.innerText = nextCount.toLocaleString();
  }

  // 2. Supabase DB에 점수 업데이트 날리기 (비동기 처리)
  supabase
    .from('cats')
    .update({ pet_count: nextCount })
    .eq('id', catId)
    .then(({ error }) => {
      if (error) console.error('하트 원격 갱신 실패:', error);
    });

  // 오디오 재생
  if (Math.random() < 0.2) {
    playMeowSound();
  } else {
    playPurrSound();
  }

  // 실시간 랭킹 보드 업데이트
  renderLeaderboard();

  // 하트 파티클 및 파동 효과
  createPetEffects(clientX, clientY);
}

function createPetEffects(x, y) {
  const container = document.body;

  const ripple = document.createElement('div');
  ripple.className = 'purr-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y + window.scrollY}px`;
  container.appendChild(ripple);
  
  setTimeout(() => ripple.remove(), 800);

  const particles = ['💖', '❤️', '🐾', '✨'];
  const count = 2 + Math.floor(Math.random() * 2);

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'heart-particle';
    p.innerText = particles[Math.floor(Math.random() * particles.length)];
    p.style.left = `${x}px`;
    p.style.top = `${y + window.scrollY}px`;

    const tx = (Math.random() - 0.5) * 120;
    const ty = -60 - Math.random() * 100;
    const scale = 0.6 + Math.random() * 0.8;
    const rot = (Math.random() - 0.5) * 60;

    p.style.setProperty('--tx', `${tx}px`);
    p.style.setProperty('--ty', `${ty}px`);
    p.style.setProperty('--scale', scale);
    p.style.setProperty('--rot', `${rot}deg`);

    container.appendChild(p);

    setTimeout(() => p.remove(), 1000);
  }
}

// ==========================================
// 6. 회원가입 및 로그인 시스템 로직
// ==========================================
function updateAuthUI() {
  const authSection = document.getElementById('auth-section');
  authSection.innerHTML = '';

  if (currentUser) {
    authSection.innerHTML = `
      <div class="user-profile">
        <i data-lucide="user-check" style="color:var(--accent-aqua)"></i>
        <span class="username-display">${escapeHTML(currentUser.nickname)}님</span>
      </div>
      <button id="logout-btn" class="btn btn-secondary">로그아웃</button>
    `;
    
    document.getElementById('logout-btn').addEventListener('click', () => {
      currentUser = null;
      localStorage.removeItem('purr_user');
      updateAuthUI();
      showToast('로그아웃되었습니다.', 'success');
      renderCatGrid();
    });
  } else {
    authSection.innerHTML = `
      <button id="login-trigger-btn" class="btn btn-secondary">로그인</button>
    `;
    
    document.getElementById('login-trigger-btn').addEventListener('click', () => {
      openModal(document.getElementById('auth-modal'));
    });
  }
  
  lucide.createIcons();
}

// ==========================================
// 7. 이미지 업로드 처리 (Supabase Storage & 리사이징)
// ==========================================
async function handleCatUpload(e) {
  e.preventDefault();
  
  if (!currentUser) {
    showToast('로그인한 회원만 등록할 수 있습니다.', 'error');
    return;
  }

  const nameInput = document.getElementById('cat-name');
  const fileInput = document.getElementById('cat-image-input');

  const file = fileInput.files[0];
  if (!file) {
    showToast('고양이 사진을 올려주세요!', 'warning');
    return;
  }

  showToast('고양이 사진을 서버에 저장 중입니다... ⏳', 'warning');
  
  try {
    // 1. HTML5 Canvas를 활용하여 이미지 크기를 최대 너비 600px로 압축
    const compressedBlob = await compressImage(file, 600, 0.8);
    
    // 2. Supabase Storage 'cat-images' 버킷에 파일 업로드
    const fileExt = 'jpg';
    const fileName = `cat_${Date.now()}.${fileExt}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('cat-images')
      .upload(fileName, compressedBlob, {
        contentType: 'image/jpeg'
      });

    if (uploadError) throw uploadError;

    // 3. 업로드된 파일의 Public URL 획득
    const { data: urlData } = supabase.storage
      .from('cat-images')
      .getPublicUrl(fileName);
      
    const publicUrl = urlData.publicUrl;

    // 4. Supabase DB 'cats' 테이블에 새로운 고양이 행 삽입
    const breedSelect = document.getElementById('cat-breed');
    const newCat = {
      id: 'cat_' + Date.now(),
      name: nameInput.value.trim(),
      breed: breedSelect ? breedSelect.value : '기타',
      image_url: publicUrl,
      pet_count: 0,
      owner: currentUser.username
    };

    const { error: dbError } = await supabase
      .from('cats')
      .insert([newCat]);

    if (dbError) throw dbError;

    // 폼 초기화 및 모달 닫기
    document.getElementById('upload-form').reset();
    removeUploadPreview();
    closeModal(document.getElementById('upload-modal'));
    
    showToast(`${newCat.name} 고양이가 실시간 광장에 등록되었습니다! 🎉`, 'success');
    
    // 강제 조회 갱신
    await fetchCats();
  } catch (error) {
    console.error('고양이 업로드 실패:', error);
    showToast('등록 실패! Storage 버킷 설정이나 테이블 컬럼을 확인해 주세요.', 'error');
  }
}

// Canvas 기반 이미지 리사이징 & JPEG 압축 헬퍼
function compressImage(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas toBlob failed'));
          }
        }, 'image/jpeg', quality);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// ==========================================
// 8. 헬퍼 유틸리티 (모달 제어, 에스케이프, 토스트)
// ==========================================
function openModal(modal) {
  modal.classList.remove('hidden');
}

function closeModal(modal) {
  modal.classList.add('hidden');
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'info';
  if (type === 'success') icon = 'check-circle';
  if (type === 'error') icon = 'alert-triangle';
  if (type === 'warning') icon = 'shield-alert';

  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

function updateSoundIcon() {
  const icon = document.getElementById('sound-icon');
  if (isMuted) {
    icon.setAttribute('data-lucide', 'volume-x');
  } else {
    icon.setAttribute('data-lucide', 'volume-2');
  }
  lucide.createIcons();
}

function removeUploadPreview() {
  document.getElementById('dropzone-preview').classList.add('hidden');
  document.getElementById('dropzone-content').classList.remove('hidden');
  document.getElementById('image-preview-element').src = '';
  document.getElementById('cat-image-input').value = '';
}

// ==========================================
// 9. 이벤트 리스너 등록
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // 9-1. 모달 닫기
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el || el.classList.contains('modal-close')) {
        closeModal(el.closest('.modal-overlay'));
      }
    });
  });

  // 9-2. 로그인/회원가입 탭 토글
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
  });

  tabSignup.addEventListener('click', () => {
    tabSignup.classList.add('active');
    tabLogin.classList.remove('active');
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  });

  // 9-3. 로그인 처리
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value;

    const accounts = JSON.parse(localStorage.getItem('purr_accounts') || '[]');
    const user = accounts.find(a => a.username === u && a.password === p);

    if (user) {
      currentUser = { username: user.username, nickname: user.nickname };
      localStorage.setItem('purr_user', JSON.stringify(currentUser));
      updateAuthUI();
      closeModal(document.getElementById('auth-modal'));
      loginForm.reset();
      showToast(`${currentUser.nickname}님, 환영합니다! 🐾`, 'success');
      renderCatGrid();
    } else {
      showToast('아이디 또는 비밀번호가 틀렸습니다.', 'error');
    }
  });

  // 9-4. 회원가입 처리
  signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nick = document.getElementById('signup-nickname').value.trim();
    const u = document.getElementById('signup-username').value.trim();
    const p = document.getElementById('signup-password').value;

    const accounts = JSON.parse(localStorage.getItem('purr_accounts') || '[]');
    
    if (accounts.some(a => a.username === u)) {
      showToast('이미 존재하는 아이디입니다.', 'error');
      return;
    }

    const newAccount = { username: u, password: p, nickname: nick };
    accounts.push(newAccount);
    localStorage.setItem('purr_accounts', JSON.stringify(accounts));

    showToast('회원가입이 완료되었습니다! 로그인 해주세요.', 'success');
    tabLogin.click();
    signupForm.reset();
  });

  // 9-5. 고양이 업로드 트리거
  document.getElementById('upload-trigger-btn').addEventListener('click', () => {
    if (!currentUser) {
      showToast('고양이를 등록하려면 로그인이 필요합니다.', 'warning');
      openModal(document.getElementById('auth-modal'));
    } else {
      openModal(document.getElementById('upload-modal'));
    }
  });

  // 9-6. 업로드 이미지 파일 드롭 및 미리보기
  const dropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('cat-image-input');
  
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btn-remove-image')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        document.getElementById('image-preview-element').src = event.target.result;
        document.getElementById('dropzone-content').classList.add('hidden');
        document.getElementById('dropzone-preview').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('btn-remove-image').addEventListener('click', (e) => {
    e.stopPropagation();
    removeUploadPreview();
  });

  // 9-7. 고양이 업로드 폼 제출
  document.getElementById('upload-form').addEventListener('submit', handleCatUpload);

  // 9-8. 실시간 랭킹 패널 토글 (모바일용)
  const rankingSidebar = document.getElementById('ranking-sidebar');
  document.getElementById('ranking-toggle-btn').addEventListener('click', () => {
    rankingSidebar.classList.toggle('open');
  });
  document.getElementById('close-ranking-btn').addEventListener('click', () => {
    rankingSidebar.classList.remove('open');
  });

  // 9-9. 음소거 토글
  document.getElementById('sound-toggle-btn').addEventListener('click', () => {
    isMuted = !isMuted;
    localStorage.setItem('purr_mute', JSON.stringify(isMuted));
    updateSoundIcon();
    showToast(isMuted ? '음소거되었습니다.' : '효과음이 켜졌습니다.', 'success');
  });

  // 9-10. 매크로 확인 버튼 클릭
  document.getElementById('macro-confirm-btn').addEventListener('click', () => {
    document.getElementById('macro-warning').classList.add('hidden');
    lastPetTimes = [];
  });

  // 로고 누르면 맨 위로 스크롤
  document.getElementById('logo-btn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// ==========================================
// 10. 카테고리 필터 및 실시간 검색 이벤트
// ==========================================
function setupFilterEvents() {
  const chipsContainer = document.getElementById('category-chips');
  const searchInput = document.getElementById('breed-search-input');

  if (chipsContainer) {
    chipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;

      chipsContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      activeBreed = chip.dataset.breed;
      renderCatGrid();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderCatGrid();
    });
  }
}
