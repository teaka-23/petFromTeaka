const greeting = document.getElementById('greeting');
const button = document.getElementById('changeText');
const ipAddress = document.getElementById('ipAddress');
const currentTime = document.getElementById('currentTime');

button.addEventListener('click', () => {
  greeting.textContent = greeting.textContent === 'Hello, World!!!'
    ? 'Привет, мир!!!'
    : 'Hello, World!!!';
});

async function loadIpAddress() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    ipAddress.textContent = data.ip || 'неизвестно';
  } catch (error) {
    ipAddress.textContent = 'недоступен';
  }
}

function updateCurrentTime() {
  const now = new Date();
  currentTime.textContent = now.toLocaleTimeString('ru-RU');
}

loadIpAddress();
updateCurrentTime();
setInterval(updateCurrentTime, 1000);
