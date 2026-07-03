import { initialCats } from './cats-data.js';

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

// ==========================================
// 2. 초기 데이터 로드 및 로컬스토리지 동기화
// ==========================================
function initApp() {
  // 고양이 데이터 로드
  const storedCats = localStorage.getItem('purr_cats');
  if (storedCats) {
    cats = JSON.parse(storedCats);
  } else {
    cats = [...initialCats];
    localStorage.setItem('purr_cats', JSON.stringify(cats));
  }

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

  updateAuthUI();
  renderCatGrid();
  renderLeaderboard();
  
  // Lucide 아이콘 렌더링
  lucide.createIcons();
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
  // "미아오우" 느낌을 주기 위해 350Hz -> 650Hz -> 450Hz로 급격히 휘어짐
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

// 4-1. 핀터레스트 스타일 고양이 그리드 렌더링
function renderCatGrid() {
  const grid = document.getElementById('cat-grid');
  grid.innerHTML = '';

  cats.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.dataset.id = cat.id;

    card.innerHTML = `
      <div class="pet-zone" data-id="${cat.id}">
        <img src="${cat.image}" class="cat-image" alt="${cat.name}">
        <div class="pet-hint">
          <i data-lucide="sparkles"></i>
          <span>문질러서 쓰다듬기</span>
        </div>
      </div>
      <div class="cat-info">
        <div class="cat-name-row">
          <h3 class="cat-card-name">${escapeHTML(cat.name)}</h3>
          ${cat.breed ? `<span class="cat-breed-tag">${escapeHTML(cat.breed)}</span>` : ''}
        </div>
        <p class="cat-card-desc">${escapeHTML(cat.description)}</p>
        <div class="pet-counter">
          <div class="pet-stat">
            <i data-lucide="heart" class="heart-icon"></i>
            <span class="pet-stat-count" id="count-${cat.id}">${cat.petCount.toLocaleString()}</span>
          </div>
          <button class="pet-action-btn" data-id="${cat.id}">
            <i data-lucide="smile"></i>
            <span>쓰다듬어주기</span>
          </button>
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
  const sorted = [...cats].sort((a, b) => b.petCount - a.petCount);
  
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
          <img src="${cat.image}" alt="${cat.name}">
        </div>
        <div class="podium-step">
          <span>${rankNum}</span>
        </div>
        <span class="podium-name">${escapeHTML(cat.name)}</span>
        <span class="podium-score">${cat.petCount.toLocaleString()} P</span>
      </div>
    `;
  };

  // 1등, 2등, 3등 단상 꽂기 (CSS flex order로 배치 조정됨)
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
        <img src="${cat.image}" alt="${cat.name}">
      </div>
      <div class="ranking-info">
        <div class="ranking-name">${escapeHTML(cat.name)}</div>
        <div class="ranking-breed">${escapeHTML(cat.breed || '일반 고양이')}</div>
      </div>
      <div class="ranking-score">${cat.petCount.toLocaleString()} P</div>
    `;
    listContainer.appendChild(item);
  });
}

// ==========================================
// 5. 쓰다듬기(Petting) 물리 엔진 & 매크로 탐지
// ==========================================
function setupPetInteraction(petZone, catId) {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let distanceAccumulator = 0;
  let lastPetTriggerTime = 0;

  // 마우스/터치 시작
  petZone.addEventListener('pointerdown', (e) => {
    // 로그인 체크
    if (!currentUser) {
      showToast('로그인이 필요한 기능입니다!', 'warning');
      openModal(document.getElementById('auth-modal'));
      return;
    }

    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    distanceAccumulator = 0;
    petZone.releasePointerCapture(e.pointerId); // 캡처링 해제하여 외부 드래그 원활화
  });

  // 드래그 진행 중 (문지르는 행위 감지)
  petZone.addEventListener('pointermove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    distanceAccumulator += distance;
    lastX = e.clientX;
    lastY = e.clientY;

    // 마우스를 70px 이상 문질렀을 때 쓰다듬기 1회 인정
    if (distanceAccumulator >= 70) {
      const now = Date.now();
      
      // 1. Throttling 매크로 검증: 입력 간격 체크
      if (now - lastPetTriggerTime < PET_RATE_LIMIT_MS) {
        // 너무 빠른 스피드는 누적만 차단
        distanceAccumulator = 0;
        return;
      }

      // 2. 기계식 오토 마우스 탐지: 입력 간격들의 분산 분석
      if (detectMacroPattern(now)) {
        isDragging = false;
        triggerMacroBlock();
        return;
      }

      // 쓰다듬기 승인
      triggerPet(catId, e.clientX, e.clientY);
      lastPetTriggerTime = now;
      distanceAccumulator = 0;
    }
  });

  // 마우스/터치 끝
  const stopDragging = () => {
    isDragging = false;
    distanceAccumulator = 0;
  };

  petZone.addEventListener('pointerup', stopDragging);
  petZone.addEventListener('pointerleave', stopDragging);
  petZone.addEventListener('pointercancel', stopDragging);
}

// 5-1. 매크로 입력 차단 패턴 분석기
function detectMacroPattern(now) {
  lastPetTimes.push(now);
  
  // 윈도우 크기 제한
  if (lastPetTimes.length > MACRO_CHECK_WINDOW) {
    lastPetTimes.shift();
  }

  if (lastPetTimes.length === MACRO_CHECK_WINDOW) {
    const firstTime = lastPetTimes[0];
    const lastTime = lastPetTimes[lastPetTimes.length - 1];
    const durationSec = (lastTime - firstTime) / 1000;
    
    // 평균 초당 입력 속도 계산
    const speed = lastPetTimes.length / durationSec;
    
    if (speed > MACRO_THRESHOLD_SPEED) {
      return true; // 매크로 확정
    }

    // 시간 간격의 규칙성 분석 (오토클릭 매크로는 시간 지연이 매우 일정함)
    let intervals = [];
    for (let i = 1; i < lastPetTimes.length; i++) {
      intervals.push(lastPetTimes[i] - lastPetTimes[i - 1]);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;

    // 만약 사람이 움직이는데 밀리초 간격 편차(표준편차)가 3ms 이하다? 기계적인 매크로
    if (Math.sqrt(variance) < 3.5) {
      return true;
    }
  }
  return false;
}

// 5-2. 매크로 감지 시 차단 화면 활성화
function triggerMacroBlock() {
  const warning = document.getElementById('macro-warning');
  warning.classList.remove('hidden');
  
  // 경고음
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

// 5-3. 쓰다듬기 실행 (카운트 증가, 효과음, 이펙트 생성)
function triggerPet(catId, clientX, clientY) {
  const cat = cats.find(c => c.id === catId);
  if (!cat) return;

  // 데이터 누적
  cat.petCount += 1;
  localStorage.setItem('purr_cats', JSON.stringify(cats));

  // 화면 카운터 갱신 (리렌더링 부하를 줄이기 위해 해당 숫자 노드만 직접 수정)
  const countEl = document.getElementById(`count-${catId}`);
  if (countEl) {
    countEl.innerText = cat.petCount.toLocaleString();
  }

  // 오디오 재생 (야옹 소리 25%, 골골 소리 75% 확률로 사운드 다양화)
  if (Math.random() < 0.2) {
    playMeowSound();
  } else {
    playPurrSound();
  }

  // 화면 랭킹 실시간 업데이트
  renderLeaderboard();

  // 문지른 좌표 기준으로 파티클 및 파동(Wave) 생성
  createPetEffects(clientX, clientY);
}

// 5-4. 쓰다듬기 파티클 및 잔상 이펙트
function createPetEffects(x, y) {
  const container = document.body;

  // 1. 골골 파동(Ripple) 효과
  const ripple = document.createElement('div');
  ripple.className = 'purr-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y + window.scrollY}px`;
  container.appendChild(ripple);
  
  setTimeout(() => ripple.remove(), 800);

  // 2. 하트/반짝이 파티클 생성 (2~3개)
  const particles = ['💖', '❤️', '🐾', '✨'];
  const count = 2 + Math.floor(Math.random() * 2);

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'heart-particle';
    p.innerText = particles[Math.floor(Math.random() * particles.length)];
    p.style.left = `${x}px`;
    p.style.top = `${y + window.scrollY}px`;

    // 랜덤 발사 궤적 값 설정 (CSS 변수로 활용)
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
    
    // 로그아웃 버튼 이벤트 리스너
    document.getElementById('logout-btn').addEventListener('click', () => {
      currentUser = null;
      localStorage.removeItem('purr_user');
      updateAuthUI();
      showToast('로그아웃되었습니다.', 'success');
      
      // 로그아웃 시 피드 다시 그리기 (본인 고양이 여부 등 표시 갱신)
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
// 7. 이미지 업로드 처리 (Base64 변환)
// ==========================================
function handleCatUpload(e) {
  e.preventDefault();
  
  if (!currentUser) {
    showToast('로그인한 회원만 등록할 수 있습니다.', 'error');
    return;
  }

  const nameInput = document.getElementById('cat-name');
  const breedInput = document.getElementById('cat-breed');
  const descInput = document.getElementById('cat-desc');
  const fileInput = document.getElementById('cat-image-input');

  const file = fileInput.files[0];
  if (!file) {
    showToast('고양이 사진을 올려주세요!', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(event) {
    const base64Image = event.target.result;
    
    const newCat = {
      id: 'cat_' + Date.now(),
      name: nameInput.value.trim(),
      breed: breedInput.value.trim() || '일반 고양이',
      description: descInput.value.trim(),
      image: base64Image,
      petCount: 0,
      owner: currentUser.username
    };

    // 로컬 데이터 추가 및 저장
    cats.unshift(newCat); // 최신 글이 맨 처음에 오도록
    localStorage.setItem('purr_cats', JSON.stringify(cats));

    // 화면 갱신
    renderCatGrid();
    renderLeaderboard();
    
    // 폼 초기화 및 모달 닫기
    document.getElementById('upload-form').reset();
    removeUploadPreview();
    closeModal(document.getElementById('upload-modal'));
    
    showToast(`${newCat.name} 고양이가 등록되었습니다! 🎉`, 'success');
  };
  
  reader.readAsDataURL(file);
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

  // 3초 후 삭제
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

  // 9-1. 모달 닫기 공통 처리
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
      renderCatGrid(); // 로그인 후 피드 재생성
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
    tabLogin.click(); // 로그인 탭으로 전환
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

  // 9-10. 매크로 확인 확인 버튼
  document.getElementById('macro-confirm-btn').addEventListener('click', () => {
    document.getElementById('macro-warning').classList.add('hidden');
    lastPetTimes = []; // 타임스탬프 리셋
  });

  // 9-11. 피드 카드 내의 "쓰다듬어주기" 버튼 클릭 이벤트 위임
  document.getElementById('cat-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.pet-action-btn');
    if (btn) {
      if (!currentUser) {
        showToast('로그인이 필요한 기능입니다!', 'warning');
        openModal(document.getElementById('auth-modal'));
        return;
      }
      const catId = btn.dataset.id;
      // 버튼은 마우스 궤적이 없으므로 마우스 중심 기준 대략 좌표 계산하여 이펙트 생성
      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // 쓰다듬기 실행 (Throttling 속도 체크)
      const now = Date.now();
      if (detectMacroPattern(now)) {
        triggerMacroBlock();
        return;
      }
      triggerPet(catId, x, y);
    }
  });

  // 로고 누르면 맨 위로 스크롤
  document.getElementById('logo-btn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
