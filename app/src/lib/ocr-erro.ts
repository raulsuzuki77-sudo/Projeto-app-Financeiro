/** O PDF exige senha (ou a senha informada está errada). */
export class ErroPdfProtegido extends Error {
  constructor(readonly incorreta: boolean) {
    super(incorreta ? "A senha do PDF está incorreta." : "Este PDF é protegido por senha.");
  }
}
