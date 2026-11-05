// School portal presentation for the hackathon; archive storage remains unchanged.
document.title='강원대학교 LXP · 수업 자료 보관함';
const archiveAside=document.querySelector('aside');
archiveAside.classList.add('archive-sidebar');
archiveAside.querySelector('.brand').innerHTML='<span class="knu-word">KNU <em>강원대학교</em><b>LXP · 수업 자료 보관함</b></span>';
archiveAside.querySelector('.brand').href='#archive';
document.querySelector('.eyebrow').textContent='KANGWON NATIONAL UNIVERSITY · LXP';
document.querySelector('h1').textContent='수업 자료 보관함';
document.querySelector('.heading p').textContent='강의 자료와 나의 필기를 과목·주차별로 보관하세요.';
document.querySelector('footer').innerHTML='<span>강원대학교 LXP · 나의 학습 기록</span><span>해커톤 시연용 · 학교 공식 서비스 아님</span>';
const shell=document.createElement('div');shell.innerHTML=`
<nav class="school-rail" aria-label="학교 주요 메뉴"><button id="school-menu" aria-label="전체 메뉴 열기" aria-expanded="true">☰</button><button id="school-home" class="rail-active"><span>⌂</span>홈</button><button id="school-courses"><span>◇</span>수강 강좌</button><button id="school-all"><span>◎</span>전체 강좌</button><div class="rail-bottom"><span class="school-avatar">김</span><small>김학생</small></div></nav>
<section id="portal"><div class="portal-header"><div class="knu-word">KNU <em>강원대학교</em></div><div><span class="demo-label">해커톤 시연용</span><span class="bell">♧</span></div></div><div class="portal-body"><div class="portal-heading"><div><p>강원대학교 학습관리시스템</p><h1>나의 강좌</h1></div><span>2026년 2학기 &nbsp; ▾</span></div><div class="portal-tools">썸네일 보기 ☑ &nbsp; │ &nbsp; 설정 ⚙ &nbsp; │ &nbsp; 모두 접기 ▴</div><div class="course-grid"><button class="course-card"><div class="course-art"><span>ARTIFICIAL<br>INTELLIGENCE</span><i>01</i></div><div class="course-copy"><small>2026년 · 2학기 · 교과과정<br>삼척 · 학부</small><h2>인공지능 (1)</h2><p><span>김</span> 김교수</p></div></button><button class="course-card"><div class="course-art gold"><span>DATABASE<br>DESIGN</span><i>02</i></div><div class="course-copy"><small>2026년 · 2학기 · 교과과정<br>삼척 · 학부</small><h2>데이터베이스설계및관리 (1)</h2><p><span>장</span> 장교수</p></div></button></div><button id="portal-archive-banner"><span>▱</span><div><b>수업 자료 보관함</b><small>자료와 필기를 한곳에, 학기가 끝나도 그대로.</small></div><strong>바로가기 →</strong></button><p class="portal-disclaimer">학교 화면을 참고해 제작한 해커톤 데모입니다. 실제 학교 계정과 연동되지 않습니다.</p></div></section>
<button id="menu-shade" aria-label="메뉴 닫기"></button><section id="school-drawer" aria-label="전체 메뉴"><div class="drawer-logo knu-word">KNU <em>강원대학교</em></div><div class="drawer-links"><button data-info="시스템 공지">♧ <span>시스템 공지</span></button><button data-info="시스템 오류 접수">♧ <span>시스템 오류 접수</span></button><button data-info="FAQ">ⓘ <span>FAQ</span></button><button data-info="AI자막 생성 요청">♧ <span>AI자막 생성 요청</span></button><button id="drawer-archive"><span class="drawer-folder">▱</span><span>수업 자료 보관함</span><small>NEW</small><b>›</b></button></div><div class="drawer-banners"><div class="banner-cyan"><b>나의 학습 기록</b><span>자료부터 필기까지, 학기가 끝나도 오래도록</span></div><div class="banner-blue"><b>스마트캠퍼스 e-루리</b><span>KANGWON NATIONAL UNIVERSITY</span></div></div><div class="drawer-note">해커톤 시연용 화면 · 학교 공식 서비스 아님</div></section>`;
document.body.prepend(shell);
const setMenu=open=>{document.body.classList.toggle('menu-open',open);document.querySelector('#school-menu').setAttribute('aria-expanded',String(open))};
const showArchive=()=>{document.body.classList.add('archive-view');setMenu(false);location.hash='archive'};
const showPortal=()=>{document.body.classList.remove('archive-view');setMenu(false);location.hash='home'};
document.querySelector('#school-menu').onclick=()=>setMenu(!document.body.classList.contains('menu-open'));
document.querySelector('#menu-shade').onclick=()=>setMenu(false);
document.querySelector('#drawer-archive').onclick=document.querySelector('#portal-archive-banner').onclick=showArchive;
document.querySelector('#school-home').onclick=showPortal;
document.querySelector('#school-courses').onclick=document.querySelector('#school-all').onclick=showPortal;
document.querySelectorAll('.course-card').forEach(b=>b.onclick=showArchive);
document.querySelectorAll('[data-info]').forEach(b=>b.onclick=()=>toast(b.dataset.info+'은 시연 범위에 포함되지 않습니다. 아래 수업 자료 보관함을 선택해주세요.'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')setMenu(false)});
if(location.hash==='#archive')showArchive();else setMenu(true);
