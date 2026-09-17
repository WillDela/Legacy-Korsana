const Card = ({ children, style = {} }) => (
  <div className="bg-white rounded-2xl shadow-sm" style={{ padding: '24px', ...style }}>
    {children}
  </div>
);

export default Card;
