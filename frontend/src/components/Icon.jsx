// Google Material Symbols (loaded in index.html). Names: https://fonts.google.com/icons
export default function Icon({ name, fill = false, size, className = '' }) {
  return (
    <span
      className={`icon ${fill ? 'icon-fill' : ''} ${className}`}
      style={size ? { fontSize: size } : undefined}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}
