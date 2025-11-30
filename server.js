// Sistema de Banco de Horas + Login/Registro + Processamento PDF
// Necessita instalar: express, pdf-parse, fs, path, bcryptjs, body-parser, multer

const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pdfParse = require('pdf-parse');
const multer = require('multer');

const app = express();
app.use(express.static('public'));
app.use(express.json());

// Diretórios
const DIR_LOGIN = path.join(__dirname, 'json','reclogin.json');
const DIR_HORAS = path.join(__dirname, 'json','dadosHoras');
if (!fs.existsSync(DIR_HORAS)) fs.mkdirSync(DIR_HORAS);

// Upload de PDF
const upload = multer({ dest: 'uploads/' });

//--------------------------------------------------------
// 1) REGISTRO
//--------------------------------------------------------
app.post('/register', (req, res) => {
    const { login, senha, nome, idColab } = req.body;

    if (!login || !senha || !nome)
        return res.status(400).json({ erro: 'Campos obrigatórios faltando.' });

    let data = { usuarios: [] };
    if (fs.existsSync(DIR_LOGIN)) {
        data = JSON.parse(fs.readFileSync(DIR_LOGIN));
    }

    if (data.usuarios.some(u => u.login === login)) {
        return res.status(400).json({ erro: 'Login já existe.' });
    }

    const hash = bcrypt.hashSync(senha, 10);

    data.usuarios.push({ login, senha: hash, nome, idColab: idColab || null });

    fs.writeFileSync(DIR_LOGIN, JSON.stringify(data, null, 2));
    res.json({ sucesso: true, msg: 'Usuário registrado com sucesso!' });
});

//--------------------------------------------------------
// 2) LOGIN
//--------------------------------------------------------
app.post('/login', (req, res) => {
    const { login, senha } = req.body;

    if (!fs.existsSync(DIR_LOGIN)) {
        return res.status(400).json({ erro: 'Nenhum usuário registrado.' });
    }

    const data = JSON.parse(fs.readFileSync(DIR_LOGIN));
    const user = data.usuarios.find(u => u.login === login);

    if (!user) return res.status(400).json({ erro: 'Usuário não encontrado.' });

    const ok = bcrypt.compareSync(senha, user.senha);
    if (!ok) return res.status(400).json({ erro: 'Senha incorreta.' });

    res.json({ sucesso: true, msg: 'Login realizado.' });
});

//--------------------------------------------------------
// 3) PROCESSAR PDF E GERAR BANCO DE HORAS
//--------------------------------------------------------
app.post('/upload-ponto', upload.single('pdf'), async (req, res) => {
    try {
        const pdfBuffer = fs.readFileSync(req.file.path);
        const parsed = await pdfParse(pdfBuffer);
        const texto = parsed.text;

        // Extrair dados
        const id = pegar(texto, /ID:\s*(\d+)/);
        const nome = pegar(texto, /Nome do colaborador:\s*(.+)/);
        const cpf = pegar(texto, /CPF:\s*(\d+)/);
        const data = pegar(texto, /Data:\s*(\d{2}\/\d{2}\/\d{4})/);
        const hora = pegar(texto, /Hora:\s*(\d{2}:\d{2}:\d{2})/);

        if (!id || !data || !hora) {
            return res.status(400).json({ erro: 'Informações obrigatórias não encontradas no PDF.' });
        }

        // Criar arquivo do colaborador
        const arquivo = path.join(DIR_HORAS, `${id}.json`);

        let registro = {
            id,
            colaborador: nome || '',
            cpf: cpf || '',
            dias: []
        };

        if (fs.existsSync(arquivo)) {
            registro = JSON.parse(fs.readFileSync(arquivo));
        }

        // Verificar dia existente
        const diaISO = formataDataISO(data);
        let diaObj = registro.dias.find(d => d.data === diaISO);
        
        if (!diaObj) {
            diaObj = { data: diaISO, marcacoes: [] };
            registro.dias.push(diaObj);
        }

        diaObj.marcacoes.push(hora);

        // Calcular horas se houver duas marcações
        if (diaObj.marcacoes.length >= 2) {
            const entrada = diaObj.marcacoes[0];
            const saida = diaObj.marcacoes[diaObj.marcacoes.length - 1];

            const minutos = calcularDiferenca(entrada, saida);
            const jornada = 7 * 60 + 20; // 7h20
            const intervalo = 60; // 1h almoço

            const trabalhado = minutos - intervalo;
            const extras = trabalhado - jornada;

            diaObj.entrada = entrada;
            diaObj.saida = saida;
            diaObj.horas_trabalhadas = minutosParaHora(trabalhado);
            diaObj.horas_extras = extras > 0 ? minutosParaHora(extras) : '00:00';
        }

        // Salvar
        fs.writeFileSync(arquivo, JSON.stringify(registro, null, 2));

        res.json({ sucesso: true, dados: registro });

    } catch (e) {
        res.status(500).json({ erro: 'Falha ao processar PDF', detalhes: e.message });
    } finally {
        fs.unlinkSync(req.file.path);
    }
});

//--------------------------------------------------------
// FUNÇÕES ÚTEIS
//--------------------------------------------------------
function pegar(texto, regex) {
    const m = texto.match(regex);
    return m ? m[1].trim() : null;
}

function formataDataISO(d) {
    const [dia, mes, ano] = d.split('/');
    return `${ano}-${mes}-${dia}`;
}

function calcularDiferenca(h1, h2) {
    const [h_1, m_1] = h1.split(':').map(Number);
    const [h_2, m_2] = h2.split(':').map(Number);
    return (h_2 * 60 + m_2) - (h_1 * 60 + m_1);
}

function minutosParaHora(m) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

//--------------------------------------------------------
// INICIAR SERVIDOR
//--------------------------------------------------------
app.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
});

