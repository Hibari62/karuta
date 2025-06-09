// public/lobby.js

// Récupération des éléments du DOM
const usernameInput = document.getElementById('usernameInput');
const roomInput = document.getElementById('roomInput');
const createBtn = document.getElementById('createBtn');
const roomsListDiv = document.getElementById('roomsList');
const lobbyDiv = document.getElementById('lobby');
const pregameDiv = document.getElementById('pregame');
const teamsBoxDiv = document.getElementById('teamsBox');

let currentUsername = null;
let currentRoom = null;

// Fonction utilitaire pour activer/désactiver les boutons
function updateButtons() {
  const hasUsername = usernameInput.value.trim().length > 0;
  const hasRoomName = roomInput.value.trim().length > 0;

  // Bouton "Créer une salle"
  createBtn.disabled = !(hasUsername && hasRoomName);

  // Boutons "Rejoindre" pour chaque salle
  const joinButtons = document.querySelectorAll('.joinBtn');
  joinButtons.forEach((btn) => {
    btn.disabled = !hasUsername;
  });
}

// Événement quand on tape dans le pseudo ou le nom de salle
usernameInput.addEventListener('input', updateButtons);
roomInput.addEventListener('input', updateButtons);

// Clic sur "Créer une salle"
createBtn.addEventListener('click', () => {
  const roomName = roomInput.value.trim();
  const username = usernameInput.value.trim();
  if (!roomName || !username) return;

  // Conserver localement pour la prépartie
  currentUsername = username;
  currentRoom = roomName;

  // Envoyer l’événement au serveur
  socket.emit('create_room', { roomName, username });
});

// Fonction pour afficher dynamiquement la liste des salles
function renderRoomsList(roomNames) {
  // Nettoyer la liste
  roomsListDiv.innerHTML = '';

  if (roomNames.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Aucune salle disponible';
    roomsListDiv.appendChild(p);
    return;
  }

  // Pour chaque nom de salle, créer un élément
  roomNames.forEach((rn) => {
    const container = document.createElement('div');
    container.classList.add('roomItem');

    const span = document.createElement('span');
    span.textContent = rn;

    const joinBtn = document.createElement('button');
    joinBtn.textContent = 'Rejoindre';
    joinBtn.classList.add('joinBtn');
    joinBtn.disabled = usernameInput.value.trim().length === 0;
    joinBtn.dataset.room = rn;

    // Au clic, on envoie un événement "join_room"
    joinBtn.addEventListener('click', () => {
      const username = usernameInput.value.trim();
      if (!username) return;
      currentUsername = username;
      currentRoom = rn;
      socket.emit('join_room', { roomName: rn, username });
    });

    container.appendChild(span);
    container.appendChild(joinBtn);
    roomsListDiv.appendChild(container);
  });
}

// Écouter l’événement "room_list" envoyé par le serveur
socket.on('room_list', (roomNames) => {
  renderRoomsList(roomNames);
});

// Si le serveur renvoie une erreur à la création/jointure
socket.on('create_error', ({ message }) => {
  alert(`Erreur création : ${message}`);
});
socket.on('join_error', ({ message }) => {
  alert(`Erreur jointure : ${message}`);
});

// Si tout s’est bien passé, le serveur nous confirme la jointure/création

socket.on('join_success', ({ roomName, teams, state, totalCards, selectedMap }) => {
  currentRoom = roomName;
  currentUsername = usernameInput.value.trim();
  window.currentRoom = currentRoom;
  window.currentUsername = currentUsername;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('pregame').style.display = 'block';
  document.getElementById('teamsBox').style.display = 'block';
  renderTeams(teams);
});


// Fonction utilitaire pour afficher la liste des joueurs par équipe
function renderTeams({ team1, team2 }) {
  const team1ListDiv = document.getElementById('team1List');
  const team2ListDiv = document.getElementById('team2List');

  // Vider les anciens contenus
  team1ListDiv.innerHTML = '';
  team2ListDiv.innerHTML = '';

  // Remplir équipe 1
  team1.forEach((uname) => {
    const div = document.createElement('div');
    div.textContent = uname;
    div.classList.add('teamMember');
    // Si c’est notre pseudo, on peut éventuellement masquer ou styliser différemment
    if (uname === currentUsername) {
      div.style.fontWeight = 'bold';
      div.style.color = '#801d1a';
    }
    team1ListDiv.appendChild(div);
  });

  // Remplir équipe 2
  team2.forEach((uname) => {
    const div = document.createElement('div');
    div.textContent = uname;
    div.classList.add('teamMember');
    if (uname === currentUsername) {
      div.style.fontWeight = 'bold';
      div.style.color = '#801d1a';
    }
    team2ListDiv.appendChild(div);
  });
}