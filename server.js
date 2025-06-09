// server.js

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Structure en mémoire pour stocker les salles, leurs joueurs, l'état prégame et l'état de la partie
// rooms = {
//   [roomName]: {
//     players: [ { id: socket.id, username: 'Alice', team: 1 }, … ],
//     state: 'settings' | 'card_select' | 'in_game',
//     totalCards: <nombre choisi>,
//     seiyuuList: [ { id, name, gender, link }, … ],  // liste des cartes éventuelles
//     selectedMap: { [cardId]: true/false, … },       // quelles cartes ont été cochées
//     gameState: {
//       team1: [ { id, name, gender, link, position }, … ], // position ∈ [0..29]
//       team2: [ { … }, … ],
//       ready: { team1: false, team2: false }
//     }
//   },
//   …
const rooms = {};

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
// Servir les fichiers statiques du dossier "public"
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  // À chaque nouvelle connexion, on envoie la liste des salles existantes
  socket.emit('room_list', Object.keys(rooms));

  // Création d'une nouvelle salle
  socket.on('create_room', ({ roomName, username }) => {
    if (!roomName || !username) {
      return;
    }
    if (rooms[roomName]) {
      socket.emit('create_error', { message: 'Cette salle existe déjà.' });
      return;
    }
    // Création de la salle et ajout du joueur en équipe 1
    rooms[roomName] = {
      players: [ { id: socket.id, username, team: 1 } ],
      state: 'settings',        // On démarre en phase "settings"
      totalCards: 50,           // Valeur par défaut
      seiyuuList: [],          // sera rempli par le créateur plus tard
      selectedMap: {},           // Aucune carte sélectionnée
      gameState: null            // pas encore de partie lancée
    };
    socket.join(roomName);

    // Envoi de confirmation au créateur (join_success)
    const team1 = rooms[roomName].players
      .filter((p) => p.team === 1)
      .map((p) => p.username);
    const team2 = rooms[roomName].players
      .filter((p) => p.team === 2)
      .map((p) => p.username);


    socket.emit('join_success', {
      roomName,
      teams: { team1, team2 },
      yourTeam: 1,
      state: rooms[roomName].state,
      totalCards: rooms[roomName].totalCards,
      seiyuuList: rooms[roomName].seiyuuList,
      selectedMap: rooms[roomName].selectedMap
    });

    // Mettre à jour la liste des salles pour tous les clients du lobby
    io.emit('room_list', Object.keys(rooms));
  });

  // Rejoindre une salle existante
  socket.on('join_room', ({ roomName, username }) => {
    if (!roomName || !username) {
      return;
    }
    const room = rooms[roomName];
    if (!room) {
      // La salle n'existe pas (peut-être supprimée entre-temps)
      socket.emit('join_error', { message: 'Cette salle n’existe pas.' });
      return;
    }
    // Ajouter le joueur en équipe 1 par défaut
    room.players.push({ id: socket.id, username, team: 1 });
    socket.join(roomName);

    // Préparer les listes d’équipes à envoyer
    const team1 = room.players
      .filter((p) => p.team === 1)
      .map((p) => p.username);
    const team2 = room.players
      .filter((p) => p.team === 2)
      .map((p) => p.username);

    // Envoyer la confirmation de jointure à ce client
    socket.emit('join_success', {
      roomName,
      teams: { team1, team2 },
      yourTeam: 1,
      state: room.state,
      totalCards: room.totalCards,
      seiyuuList: room.seiyuuList,
      selectedMap: room.selectedMap
    });

    // Mettre à jour la liste des salles pour tous les clients du lobby
    io.emit('room_list', Object.keys(rooms));

    // Notifier les autres joueurs dans cette salle du changement d’équipes
    io.to(roomName).emit('update_teams', { team1, team2 });

      // → SI la partie est déjà en cours, on envoie immédiatement au nouvel arrivant
    //    l’état “game_started” pour qu’il puisse voir le plateau
    if (room.state === 'in_game') {
      socket.emit('game_started', {
        gameState: room.gameState
      });
    }

  });

  // Changement d'équipe
  socket.on('switch_team', ({ roomName, targetTeam }) => {
    const room = rooms[roomName];
    if (!room) {
        return;
    }
    // Trouver le joueur dans la salle
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
        return;
    }
    // Mettre à jour son équipe
    player.team = targetTeam;

    // Recalculer les listes d’équipes
    const team1 = room.players
      .filter((p) => p.team === 1)
      .map((p) => p.username);
    const team2 = room.players
      .filter((p) => p.team === 2)
      .map((p) => p.username);

    // Émettre à tous les joueurs de la salle la nouvelle répartition
    io.to(roomName).emit('update_teams', { team1, team2 });
  });

  // ======================
  // Un joueur décide de passer en "card_select" (click sur Valider)
  // ======================
  socket.on('validate_settings', ({ roomName, totalCards, seiyuuList }) => {
    const room = rooms[roomName];
    if (!room) {
      return;
    }
    // Mettre à jour l'état de la salle
    room.state = 'card_select';
    room.totalCards = totalCards;
    room.seiyuuList = seiyuuList;
    // Réinitialiser la selectedMap (aucune sélection au départ)
    room.selectedMap = {};
    room.seiyuuList.forEach(c => {
      room.selectedMap[c.id] = false;
    });

    // Envoyer à tous les clients dans la salle le passage en "card_select"
    io.to(roomName).emit('enter_card_selection', {
      totalCards: room.totalCards,
      seiyuuList: room.seiyuuList,
      selectedMap: room.selectedMap
    });
  });

  // ======================
  // Un joueur souhaite revenir en "settings" (click sur Retour)
  // ======================
  socket.on('back_to_settings', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) {
      return;
    }
    // Changer l'état à nouveau en "settings", on garde totalCards (au cas où)
    room.state = 'settings';
    // On ignore selectedMap (mais on peut la vider pour la prochaine entrée si on veut)
    room.selectedMap = {};
    room.seiyuuList.forEach(c => {
      room.selectedMap[c.id] = false;
    });


    io.to(roomName).emit('enter_settings', {
      totalCards: room.totalCards
    });
  });


  // ===== Sélection/désélection d'une carte par un client =====
  socket.on('toggle_card', ({ roomName, cardId, selected }) => {
    const room = rooms[roomName];
    if (!room) {
      return;
    }
    room.selectedMap[cardId] = selected;
    io.to(roomName).emit('update_card_selection', { cardId, selected });
  });

  // ===== Réinitialiser toutes les sélections (Retour) =====
  socket.on('reset_cards', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) {
      return;
    }
    room.seiyuuList.forEach(c => {
      room.selectedMap[c.id] = false;
    });
    io.to(roomName).emit('clear_all_cards');
  });

  // Un joueur clique sur "Commencer" (on lance la partie)
  // ========================
  socket.on('start_game', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) {
      return;
    }
    if (room.state !== 'card_select') {
      return;
    }

    // 1) On récupère toutes les cartes cochées (= true) dans selectedMap
    const chosenCards = room.seiyuuList.filter(c => room.selectedMap[c.id]);

    // 2) On mélange (shuffle)
    const shuffled = chosenCards.sort(() => 0.5 - Math.random());

    // 3) On divise en deux moitiés égales
    const half = Math.floor(shuffled.length / 2);
    const team1Cards = shuffled.slice(0, half);
    const team2Cards = shuffled.slice(half);

    // 4) Pour chaque équipe, on crée 30 positions [0..29], on mélange, puis on prend les N premiers indices
    function assignPositions(cardArray) {
      const indices = Array.from({ length: 30 }, (_, i) => i).sort(() => 0.5 - Math.random());
      return cardArray.map((card, idx) => ({
        id: card.id,
        name: card.name,
        gender: card.gender,
        link: card.link,
        position: indices[idx]  // chaque carte prend l'un des 30 emplacements aléatoires
      }));
    }

    const team1WithPos = assignPositions(team1Cards);
    const team2WithPos = assignPositions(team2Cards);

    // 5) On stocke l'état de la partie dans room.gameState
    room.gameState = {
      team1: team1WithPos,
      team2: team2WithPos,
      ready: { team1: false, team2: false },
      roundAnswered: false,
      roundWinner: null,
      roundRevealed: false,
      actionStarted: false
    };

    // 6) On passe la salle en état "in_game"
    room.state = 'in_game';

    // 7) On notifie tous les clients dans la salle que le jeu démarre
    io.to(roomName).emit('game_started', {
      gameState: room.gameState
    });
  });

  // ========================
  // Un joueur clique sur "Prêt" (ready) pour son équipe
  // ========================
  socket.on('player_ready', ({ roomName, team }) => {
    const room = rooms[roomName];
    if (!room || room.state !== 'in_game') return;

    // On marque l'équipe comme prête
    room.gameState.ready[`team${team}`] = true;

    // On notifie tout le monde de l'état “ready” de cette équipe
    io.to(roomName).emit('team_ready', { team, ready: true });

    const bothReady = room.gameState.ready.team1 && room.gameState.ready.team2;
    if (bothReady && !room.gameState.actionStarted) {
      room.gameState.actionStarted = true; // pour éviter double‐déclenchement
      startNextActionRound(roomName);
  }
  });

  // ========================
  // Un joueur déplace une carte en mode préparation
  // ========================
  socket.on('move_card', ({ roomName, team, fromPos, toPos }) => {
    const room = rooms[roomName];
    if (!room || room.state !== 'in_game') return;

    // On modifie la position des cartes dans room.gameState.team{team}
    const arr = team === 1 ? room.gameState.team1 : room.gameState.team2;

    // Trouver l’indice du tableau pour la carte à fromPos
    const idxFrom = arr.findIndex(c => c.position === fromPos);
    if (idxFrom === -1) return; // pas trouvé

    // S’il existe déjà une carte à toPos, on échange les positions
    const idxTo = arr.findIndex(c => c.position === toPos);
    if (idxTo !== -1) {
      // On swap
      const tmp = arr[idxFrom].position;
      arr[idxFrom].position = arr[idxTo].position;
      arr[idxTo].position = tmp;
    } else {
      // On déplace simplement
      arr[idxFrom].position = toPos;
    }

    // On notifie tout le monde du déplacement
    io.to(roomName).emit('card_moved', { team, fromPos, toPos });
  });


  // Gestion de la déconnexion
  socket.on('disconnect', () => {
    let roomToDelete = null;

    // Parcourir toutes les salles pour voir si ce socket y était
    for (const [roomName, roomData] of Object.entries(rooms)) {
      const idx = roomData.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
       const usernameToRemove = roomData.players[idx].username;
       roomData.players.splice(idx, 1);
        // S’il n’y a plus personne, on marque la salle pour suppression
        if (roomData.players.length === 0) {
          roomToDelete = roomName;
        } else {
          // Sinon, on notifie les autres joueurs de cette salle du changement d’équipes
          const team1 = roomData.players
            .filter((p) => p.team === 1)
            .map((p) => p.username);
          const team2 = roomData.players
            .filter((p) => p.team === 2)
            .map((p) => p.username);
          io.to(roomName).emit('update_teams', { team1, team2 });
        }
        break; // un socket ne peut être que dans une seule room “de jeu” à la fois dans notre logique
      }
    }

    // Supprimer la salle vide s’il y en a une
    if (roomToDelete) {
      delete rooms[roomToDelete];
    }

    // Mettre à jour la liste des salles dans le lobby
    io.emit('room_list', Object.keys(rooms));
  });


  /**
  * Quand un joueur clique sur une carte en phase action.
  * Seul le premier clic valide par manche est pris en compte.
  * On informe tout le monde immédiatement de la carte cliquée (fond rouge/violet).
  * Puis on enchaîne sur revealCorrectCard dans 2 s.
  */
  socket.on('card_response', ({ roomName, cardId, username, team }) => {
    const room = rooms[roomName];
    if (!room || room.state !== 'in_game') return;

    // Si déjà répondu cette manche, on ignore
    if (room.gameState.roundAnswered) return;

    // C’est maintenant la première réponse
    room.gameState.roundAnswered = true;
    room.gameState.roundWinner  = { username, team, cardId };

    // 1) On annule le timer 15 s (timeout)
    if (room.actionTimers.roundTimer) {
      clearTimeout(room.actionTimers.roundTimer);
      room.actionTimers.roundTimer = null;
    }

    // 2) On notifie tous les joueurs qu’une carte a été cliquée en premier
    //    avec le fond [rouge si team=1 / violet si team=2]
    io.to(roomName).emit('card_clicked', {
      cardId,
      team  // pour que chacun sache la couleur à appliquer
    });

    // 3) On programme la révélation verte dans 2 s
    room.actionTimers.revealTimer = setTimeout(() => {
      revealCorrectCard(roomName);
    }, 2000);
  });


  /**
  * Lance une manche d'action dans la salle concernée.
  * - Prépare l'extrait à jouer
  * - Envoie 'action_started' à tous les clients pour qu'ils chargent/lancent l'audio
  * - Met en place un timer de 15 s pour la révélation "timeout"
  */
  function startNextActionRound(roomName) {
    const room = rooms[roomName];
    if (!room) return;

      // Reset ready flags for both teams and notify clients
    clearReadyFlags(room);
    io.to(roomName).emit('team_ready', { team: 1, ready: false });
    io.to(roomName).emit('team_ready', { team: 2, ready: false });

    // Si on n'a pas encore construit la playlist, construisons‐la :
    if (!room.gameState.playlist) {
      // room.gameState.team1 et team2 contiennent déjà les cartes restantes, 
      // mais on veut juste le nom/ID ici pour la playlist audio. On peut créer un tableau de {id, link, correctTeam}
      const allCards = room.gameState.team1.concat(room.gameState.team2);
      // Par convention, on part de là :
      //   .playlist = [{ id, name, link, correctTeam (1 ou 2) }, …] (dans un ordre mélangé).
      const flat = allCards.map(c => ({
        id: c.id,
        name: c.name,
        link: c.link,
        correctTeam: room.gameState.team1.find(x => x.id === c.id) ? 1 : 2
      }));
      shuffleArray(flat);
      room.gameState.playlist = flat;
      room.gameState.currentIndex = 0;
    }

    const idx = room.gameState.currentIndex;
    if (idx >= room.gameState.playlist.length) {
      // Fin de la playlist → match terminé
      io.to(roomName).emit('match_over');
      return;
    }

    // 1) On récupère la carte “courante”
    const currentCard = room.gameState.playlist[idx];

    // 2) On notifie tous les clients de la phase action imminente + extrait à charger
    io.to(roomName).emit('action_started', {
      link: currentCard.link,
      cardId: currentCard.id,       // pour savoir laquelle est la bonne
      correctTeam: currentCard.correctTeam
    });

    // 3) On initialise les drapeaux pour la manche
    room.gameState.roundAnswered = false;  // personne n’a encore cliqué
    room.gameState.roundWinner  = null;   // id du joueur qui a cliqué en premier, ou null

    // 4) Si vous voulez stocker l’heure de départ pour logs : 
    room.gameState.actionStartTime = Date.now();

    // 5) Planifier le timeout de 15 s
    if (room.actionTimers && room.actionTimers.roundTimer) {
      clearTimeout(room.actionTimers.roundTimer);
    } else {
      room.actionTimers = {};
    }
    room.actionTimers.roundTimer = setTimeout(() => {
      // Si personne n’a cliqué dans les 15 s, on force la révélation
      revealCorrectCard(roomName);
    }, 15000);
  }

  /**
  * Révèle la carte correcte (fond vert), 
  * gère le transfert éventuel (si équipe a cliqué correctement sur carte adverse ou mal cliqué),
  * supprime la carte après 3s, puis bascule la salle en phase "préparation".
  */
  function revealCorrectCard(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    // Empêcher double-appel
    if (room.gameState.roundRevealed) return;
    room.gameState.roundRevealed = true;

    // Annuler tous les timers en cours
    if (room.actionTimers.roundTimer) {
      clearTimeout(room.actionTimers.roundTimer);
      room.actionTimers.roundTimer = null;
    }
    if (room.actionTimers.revealTimer) {
      clearTimeout(room.actionTimers.revealTimer);
      room.actionTimers.revealTimer = null;
    }

    // 1) Déterminer la carte « courante »
    const idx = room.gameState.currentIndex;
    const currentCard = room.gameState.playlist[idx];

    // 2) Déterminer l'équipe “victoire” effective :
    //
    // Si personne n'a cliqué (roundWinner === null) => no winner, on ne fait rien de spécial.
    // Si roundWinner.cardId !== currentCard.id => premier clic était incorrect => 
    //    on “promeut” l'équipe adverse comme si elle avait trouvé (correctTeam).
    // Sinon (cardId === currentCard.id) => c'est bien roundWinner.team qui a trouvé.
    let originalOwner = null;
    if (room.gameState.team1.find(c => c.id === currentCard.id)) {
      originalOwner = 1;
    } else if (room.gameState.team2.find(c => c.id === currentCard.id)) {
      originalOwner = 2;
    }
    let effectiveWinnerTeam = null;
    if (room.gameState.roundWinner) {
      const { team: clickTeam, cardId: clickedId } = room.gameState.roundWinner;
      if (clickedId === currentCard.id) {
        effectiveWinnerTeam = clickTeam;
      } else {
        // Mauvaise réponse, on considère que l'adversaire a “trouvé” la bonne.
        effectiveWinnerTeam = clickTeam === 1 ? 2 : 1;
      }
    }
    // NB : currentCard.correctTeam vaut 1 ou 2.

    // 3) Envoyer à tous la révélation “verte”
    io.to(roomName).emit('reveal_card', {
      cardId: currentCard.id,
      winnerTeam: effectiveWinnerTeam // null si personne n'a cliqué
    });

    // 4) Après 3s, on supprime la carte du plateau et on gère le transfert éventuel
    room.actionTimers.removeTimer = setTimeout(() => {
      // 4.a) Supprimer la carte de gameState.team1 / team2
      room.gameState.team1 = room.gameState.team1.filter(c => c.id !== currentCard.id);
      room.gameState.team2 = room.gameState.team2.filter(c => c.id !== currentCard.id);

      // 4.b) Si quelqu’un a “gagné” et que la carte était sur le plateau adverse → lancer transfert
      if (effectiveWinnerTeam) {
        // Déterminer dans quel tableau était la carte d'origine :
        //   si currentCard.correctTeam === 1, la carte venait de l'équipe 1 initialement,
        //   sinon de l'équipe 2.
        // Si effectiveWinnerTeam trouve sur plateau adverse ↓
        if (originalOwner !== effectiveWinnerTeam) {
          // On signale à l’équipe gagnante qu’elle doit choisir une carte à donner
          // => on émet un événement qui déclenchera l’UI client pour “choisir une carte à donner”
          room.gameState.transferTeam = effectiveWinnerTeam;
          io.to(roomName).emit('prompt_card_transfer', {
            winningTeam: effectiveWinnerTeam
          });
          // IMPORTANT : On attend la réponse du client (événement 'transfer_card')
          return;
        }
        // Sinon (la carte était du côté du gagnant), on ne fait rien de spécial.
      }

      // 4.c) Si aucune équipe n'a trouvé, ou si la carte n'était pas sur le plateau adverse,
      //      on ne fait pas de transfert. On passe en préparation.
      finishActionRound(roomName);
    }, 3000);
  }

  /**
  * Quand l’équipe gagnante a cliqué sur la carte qu’elle cède,
  * on la retire de son plateau et on l’ajoute (position aléatoire) sur le plateau adverse,
  * puis on émet à tous la mise à jour (carte transférée), puis on repasse en mode préparation.
  */
  socket.on('transfer_card', ({ roomName, cardId, team: givingTeam }) => {
    const room = rooms[roomName];
    if (!room || room.state !== 'in_game') return;

    // 1) Retirer cette carte de la team qui donne
    if (givingTeam === 1) {
      room.gameState.team1 = room.gameState.team1.filter(c => c.id !== cardId);
    } else {
      room.gameState.team2 = room.gameState.team2.filter(c => c.id !== cardId);
    }

    // 2) Ajouter cette carte au plateau de l’adversaire, avec une position aléatoire parmi les 30 cases libres
    const targetTeam = (givingTeam === 1 ? 2 : 1);
    const targetArr = targetTeam === 1 ? room.gameState.team1 : room.gameState.team2;

    // Construire la « carte » à transférer : il faut retrouver sa info dans l’ancien plateau
    // (si on ne stocke pas le nom/genre/lien, on peut embarquer ces infos dans l’événement client).
    // Pour simplifier, on les extrait d’un des deux tableaux d’avant-suppression,
    // mais ici on suppose qu’on les a en mémoire, ou on doit les réenvoyer depuis le client.
    // Exemple :
    let transferredCard = null;
    // Rechercher d’abord dans le tableau d'origine côté serveur :
    //   (si équipe 1 donne, elle ne contient plus l’id, donc on repère dans la playlist)
    const fullList = room.gameState.team1.concat(room.gameState.team2).concat(room.gameState.playlist);
    // On cherche la carte dans playlist pour récupérer { id, name, gender, link } :
    for (const c of fullList) {
      if (c.id === cardId) {
        transferredCard = { id: c.id, name: c.name, gender: c.gender, link: c.link };
        break;
      }
    }
    if (!transferredCard) {
      // Cas extrême : on n’a pas trouvé dans les tableaux,  
      // mais normalement on doit l’avoir via l’événement client pour plus de sûreté.
      return;
    }

    // 3) Calculer une position aléatoire libre sur le plateau adverse (30 slots)
    const occupiedPositions = targetArr.map(c => c.position);
    const freePositions = [];
    for (let i = 0; i < 30; i++) {
      if (!occupiedPositions.includes(i)) freePositions.push(i);
    }
    const randomIndex = freePositions[Math.floor(Math.random() * freePositions.length)];

    // 4) Ajouter au tableau adverse
    transferredCard.position = randomIndex;
    if (targetTeam === 1) {
      room.gameState.team1.push(transferredCard);
    } else {
      room.gameState.team2.push(transferredCard);
    }

    // 5) Notifier tous les clients du transfert
    io.to(roomName).emit('card_transferred', {
      card: transferredCard,
      newTeam: targetTeam
    });

    // 6) Enfin, la manche d’action est officiellement terminée → repasser en préparation
    finishActionRound(roomName);
  });

  /**
  * Passe la salle en phase "préparation" :
  * - Supprime la carte de playlist/currentIndex (déjà fait). 
  * - Réinitialise les flags roundAnswered / roundRevealed.
  * - Réémet un événement aux clients pour qu'ils repassent en mode “déplacement” + ready bars visibles.
  */
  function finishActionRound(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    // 1) Incrémenter l’index de la playlist (carte déjà retirée)
    room.gameState.currentIndex++;

    // 2) Réinitialiser les flags pour la prochaine action
    room.gameState.roundAnswered = false;
    room.gameState.roundWinner  = null;
    room.gameState.roundRevealed = false;
    room.gameState.actionStarted = false;

    // 3) Passer l’état de la salle en “préparation” (on peut éventuellement garder room.state = 'in_game',
    //    mais signaler côté client “phase prep” via un événement dédié).
    //    On envoie un événement spécifique pour repasser côté client en UI-préparation.
    io.to(roomName).emit('action_phase_over', {
      team1: room.gameState.team1.map(c => ({ id: c.id, name: c.name, position: c.position })),
      team2: room.gameState.team2.map(c => ({ id: c.id, name: c.name, position: c.position }))
    });
    maybeEndMatch(roomName);
  }

  /* ───────────────── helpers fin de partie ───────────────── */
  function maybeEndMatch(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    const noCardT1 = room.gameState.team1.length === 0;
    const noCardT2 = room.gameState.team2.length === 0;
    if (!noCardT1 && !noCardT2) return;           // personne n’a (encore) gagné

    const winningTeam = noCardT1 ? 1 : 2;
    const winningPlayers = room.players
        .filter(p => p.team === winningTeam)
        .map(p => p.username);

    io.to(roomName).emit('match_over', {
      winningTeam,
      players: winningPlayers
    });

    // 10 s plus tard on ré-initialise la room
    setTimeout(() => resetRoomToPregame(roomName), 10_000);
  }

  function resetRoomToPregame(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    room.state          = 'settings';
    room.selectedMap    = {};
    room.gameState      = null;

    // on conserve éventuellement totalCards pour la partie suivante
    io.to(roomName).emit('enter_settings', {
      totalCards: room.totalCards
    });
  }

  function clearReadyFlags(room) {
    room.gameState.ready.team1 = false;
    room.gameState.ready.team2 = false;
  }


});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
});
