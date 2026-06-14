let allMessages = [];

const chat = document.getElementById("chat");
const searchBox = document.getElementById("searchBox");
const searchInfo = document.getElementById("searchInfo");
const searchNav = document.getElementById("searchNav");
const matchCounter = document.getElementById("matchCounter");

const prevMatchBtn = document.getElementById("prevMatch");
const nextMatchBtn = document.getElementById("nextMatch");

const datePicker = document.getElementById("datePicker");
const monthList = document.getElementById("monthList");
const sidebar = document.getElementById("sidebar");
const menuButton = document.getElementById("menuButton");

menuButton.onclick = () => sidebar.classList.toggle("open");

let searchTerm = "";
let matches = [];
let currentMatchIndex = -1;

fetch("chat.json")
.then(r => r.json())
.then(data => {

    allMessages = data;

    renderAllMessages();   // 🔥 key change
    buildMonthList();

});

function renderAllMessages(){

    chat.innerHTML = "";

    let lastDay = "";

    allMessages.forEach((msg, index) => {

        let day = msg.timestamp.slice(0,10);

        if(day !== lastDay){

            lastDay = day;

            let d = document.createElement("div");
            d.className = "day";
            d.innerText = day;

            chat.appendChild(d);
        }

        let div = document.createElement("div");

        div.className = "message";

        if(msg.sender === "Amirhosein")
            div.classList.add("me");
        else
            div.classList.add("other");

        div.dataset.index = index;

        div.innerHTML = `
            <div class="sender">${msg.sender}</div>
            <div class="text">${escapeHtml(msg.text)}</div>
            <div class="time">${msg.timestamp}</div>
        `;

        chat.appendChild(div);
    });
}

searchBox.addEventListener("input", () => {

    searchTerm = searchBox.value.trim().toLowerCase();

    matches = [];
    currentMatchIndex = -1;

    if(searchTerm === ""){

        searchInfo.innerText = "";
        searchNav.style.display = "none";

        clearHighlights();
        return;
    }

    allMessages.forEach((msg, i) => {

        if(msg.text.toLowerCase().includes(searchTerm)){
            matches.push(i);
        }
    });

    if(matches.length === 0){

        searchInfo.innerText = "0 results";
        searchNav.style.display = "none";
        return;
    }

    searchInfo.innerText = `${matches.length} results`;
    searchNav.style.display = "flex";

    currentMatchIndex = 0;

    highlightAll();
    scrollToMatch();
});

function highlightAll(){

    document.querySelectorAll(".message .text").forEach(el => {

        let original = el.innerText;

        let regex = new RegExp(searchTerm, "gi");

        el.innerHTML = escapeHtml(original).replace(
            regex,
            m => `<span class="highlight">${m}</span>`
        );
    });
}

function clearHighlights(){

    document.querySelectorAll(".message .text").forEach(el => {
        el.innerText = el.innerText;
    });
}

prevMatchBtn.onclick = () => {

    if(!matches.length) return;

    currentMatchIndex =
        (currentMatchIndex - 1 + matches.length) % matches.length;

    scrollToMatch();
};

nextMatchBtn.onclick = () => {

    if(!matches.length) return;

    currentMatchIndex =
        (currentMatchIndex + 1) % matches.length;

    scrollToMatch();
};

function scrollToMatch(){

    let index = matches[currentMatchIndex];

    let el = document.querySelector(
        `.message[data-index="${index}"]`
    );

    if(!el) return;

    el.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    matchCounter.innerText =
        `${currentMatchIndex + 1} / ${matches.length}`;
}

function escapeHtml(text){
    return text
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;");
}
