// Экран входа (§13.1.1): одна кнопка и честное объяснение, какие доступы
// запрашиваются и зачем. Ничего больше здесь быть не должно.

export function Login({ onDemo }: { onDemo: () => void }) {
  return (
    <div className="login">
      <div className="card login-card">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 18, fontSize: 22 }}>
          <span className="brand-mark" style={{ width: 26, height: 26 }} />
          Периметр
        </div>
        <h1>Места работы, а не только вакансии</h1>
        <p className="login-lede">
          Находит компании, где роль назревает, сопоставляет их ожидания с фактами
          вашего опыта и честно показывает разрывы.
        </p>

        <div className="scopes">
          <div className="scope"><span aria-hidden>·</span><span><b>Ваш профиль Google</b> — чтобы узнать вас при следующем входе.</span></div>
          <div className="scope"><span aria-hidden>·</span><span><b>Одна таблица на вашем диске</b> — приложение создаёт её само и видит только её. Доступа к остальным файлам оно не получает.</span></div>
          <div className="scope"><span aria-hidden>·</span><span><b>Почта не подключается.</b> Письма вы отправляете сами из своего ящика.</span></div>
        </div>

        <a className="btn btn-primary btn-block" href="/api/auth/start">Войти через Google</a>

        <button className="btn btn-ghost btn-block mt-12" onClick={onDemo}>
          Посмотреть на демо-данных
        </button>
        <p className="small muted mt-12">
          Резюме — персональные данные. Они хранятся в ЕС, передаются модели без
          сохранения истории и удаляются вместе с аккаунтом.
        </p>
      </div>
    </div>
  );
}
